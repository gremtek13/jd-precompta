import { afterEach, describe, expect, it } from 'vitest'
import {
  HYPOTHESES_DE_LA_CONCEPTION, RAISONS_ECARTEES, REFUS_EREPORTING, dateQuiRangeLAchat, dateQuiRangeLaVente,
  declarationDesAchats, declarationDesPaiements, declarationDesVentes,
  type ContexteDeclaration, type DossierEreporting, type EncaissementLu, type FactureLue, type Lecture, type LigneLue,
  type PartLue, type PieceLue, type SourcesDesAchats, type SourcesDesPaiements, type SourcesDesVentes, type TexteDePiece,
} from './ereporting'
import type { PieceHorsDeFrance, PieceHorsDeFranceTaux } from './types'

// LE CONTENU DES DÉCLARATIONS D'E-REPORTING (ligne 28.5, étape e4). CHAQUE ATTENDU EST ÉCRIT À LA MAIN, depuis la source
// que cite la ligne de commentaire qui le précède — jamais recopié du module. Les sources :
//   [A6]   spécifications externes de la DGFiP v3.2, annexe 6 « Format sémantique FE e-reporting » v1.10, onglet
//          « E-REPORTING - Flux 10 » (blocs 10.1, 10.3, 10.4 ; TT-15, TT-21, TT-28, TT-52, TT-77, TT-80, TT-81) ;
//   [A7]   même archive, annexe 7 « Règles de gestion » v1.9 (G1.02, G1.53, G1.68, G2.33, G6.23, G6.26, G6.29, G7.43) ;
//   [DG]   même archive, dossier général v3.2, § 3.7.3 à § 3.7.7 et les notes 118, 119, 125, 127 ;
//   [C]    BOI-TVA-DECLA-20-30-50-10, 30/09/2026, § 20 (les opérations exonérées en sortent), § 60 (les achats) ;
//   [T]    BOI-TVA-DECLA-20-30-50-20, 30/09/2026, § 50, § 60 (les ventes à des particuliers, par jour), § 70 ;
//   [M]    BOI-TVA-DECLA-20-30-50-30, 30/09/2026, § 60 (le mois au réel trimestriel), § 70 (le bimestre en franchise),
//          § 80 (aucune transmission sans opération), § 90 (le 10 du mois suivant) ;
//   [P]    BOI-TVA-DECLA-20-30-60, 30/09/2026, § 1 (factures du 01/09/2027 ; prestations), § 30 (les débits), § 150 ;
//   [E1]   HISTORIQUE.md, « L'E-REPORTING : L'OBLIGATION DITE JUSTE » (les phrases et la fréquence d'e1) ;
//   [E2]   la fonction `enregistrer_fiche_hors_de_france` (migration pieces_hors_de_france) : les mots de ses refus ;
//   [E3]   HISTORIQUE.md, « LA FICHE D'UN ACHAT HORS DE FRANCE, À L'ÉCRAN » : les signaux, la fiche rejugée ;
//   [D1]   HISTORIQUE.md, « LES ENCAISSEMENTS D'UNE FACTURE ÉMISE » : retraits, contre-passations, montants nets ;
//   [CO]   HISTORIQUE.md, « L'E-REPORTING : LA CONCEPTION » (§ 2.3, § 4.2, § 4.3, § 4.6 ; points 6, 7, 9, 21 ; Q3 à Q8).
// Un numéro de TVA français : « FR » + (12 + 3 × (SIREN mod 97)) mod 97 + SIREN (CLAUDE.md) — pour le SIREN fictif
// 123456782 : 123456782 mod 97 = 32, 12 + 96 = 108, 108 mod 97 = 11, soit FR11123456782.

const SIRET = '12345678200010'
const SIREN = '123456782'
const NUMERO_TVA = 'FR11123456782'
const OCTOBRE = { debut: '2027-10-01', fin: '2027-10-31' }
const NOVEMBRE = { debut: '2027-11-01', fin: '2027-11-30' }
const SEPTEMBRE_OCTOBRE = { debut: '2027-09-01', fin: '2027-10-31' }
// Après la fin d'octobre, avant son échéance du 10 novembre [M] § 90.
const LE_5_NOVEMBRE = '2027-11-05'

function dossier(o: Partial<DossierEreporting> = {}): DossierEreporting {
  return {
    id: 'd1', siret: SIRET, statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false,
    tva_periodicite: 'trimestrielle', tva_sur_debits: false, ...o,
  }
}

function contexte(o: Partial<ContexteDeclaration> = {}): ContexteDeclaration {
  return { periode: OCTOBRE, dossier: dossier(), regimeConfirme: true, aujourdHui: LE_5_NOVEMBRE, ...o }
}

const lu = <T>(lignes: T[]): Lecture<T> => ({ lignes, complete: true, motif: null })
const luEnPartie = <T>(lignes: T[], motif: string): Lecture<T> => ({ lignes, complete: false, motif })

// Un logiciel en ligne acheté à un fournisseur irlandais, autoliquidé : une pièce de 120 € sans TVA, et sa fiche.
function piece(o: Partial<PieceLue> = {}): PieceLue {
  return {
    id: 'p1', dossier_id: 'd1', type_piece: 'achat', devise: 'EUR', montant_ttc: 120, montant_devise: null, montant_tva: null,
    tiers: 'Editeur Logiciel', date_piece: '2027-10-05', ...o,
  }
}

function fiche(o: Partial<PieceHorsDeFrance> = {}): PieceHorsDeFrance {
  return {
    id: 'f1', dossier_id: 'd1', piece_id: 'p1', remplace_id: null, numero: 'INV-1', date_facture: '2027-10-05',
    type_document: '380', facture_origine_numero: null, facture_origine_date: null, devise: 'EUR', pays: 'IE',
    schema_identifiant: '0223', identifiant: 'IE6388047V', nature: 'services', autoliquidation: true, date_operation: null,
    periode_debut: null, periode_fin: null, cree_par: 'u1', cree_le: '2027-10-06T10:00:00Z', retire_le: null, retire_par: null,
    ...o,
  }
}

function taux(o: Partial<PieceHorsDeFranceTaux> = {}): PieceHorsDeFranceTaux {
  return { fiche_id: 'f1', dossier_id: 'd1', code_tva: 'AE', taux: 0, base: 120, tva: 0, motif_code: null, motif_texte: null, ...o }
}

function achats(o: Partial<SourcesDesAchats> = {}): SourcesDesAchats {
  return { pieces: lu([piece()]), fiches: lu([fiche()]), taux: lu([taux()]), textes: lu<TexteDePiece>([]), ...o }
}

const AUCUNE = new Set<string>()
const parFacture = { rangement: 'date_de_la_facture', piecesEcartees: AUCUNE } as const
const parRealisation = { rangement: 'date_de_realisation', piecesEcartees: AUCUNE } as const

// Une séance facturée à un particulier : 100 € HT à 20 %, des services, sans option pour les débits.
function facture(o: Partial<FactureLue> = {}): FactureLue {
  return {
    id: 'v1', dossier_id: 'd1', statut: 'validee', type: 'facture', date_emission: '2027-10-08', montant_ht: 100,
    montant_tva: 20, montant_ttc: 120, type_client: 'non_assujetti', nature_operation: 'services', option_debits: false,
    date_prestation: null, periode_fin: null, ...o,
  }
}

function ligne(o: Partial<LigneLue> = {}): LigneLue {
  return { facture_id: 'v1', ordre: 0, designation: 'Séance', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, ...o }
}

function ventes(o: Partial<SourcesDesVentes> = {}): SourcesDesVentes {
  return { factures: lu([facture()]), lignes: lu([ligne()]), ...o }
}

function encaissement(o: Partial<EncaissementLu> = {}): EncaissementLu {
  return {
    id: 'e1', dossier_id: 'd1', facture_id: 'v1', date_encaissement: '2027-10-15', montant: 120, annule_id: null, retire_le: null,
    ...o,
  }
}

function part(o: Partial<PartLue> = {}): PartLue {
  return { encaissement_id: 'e1', dossier_id: 'd1', taux: 20, montant: 120, ...o }
}

function paiements(o: Partial<SourcesDesPaiements> = {}): SourcesDesPaiements {
  return { factures: lu([facture()]), encaissements: lu([encaissement()]), parts: lu([part()]), ...o }
}

const parDecaissement = { contrePassation: 'date_du_decaissement' } as const
const parEncaissementAnnule = { contrePassation: 'date_de_l_encaissement_annule' } as const

const cles = (d: { refus: { cle: string }[] }) => d.refus.map((r) => r.cle)

// ── Les hypothèses et la liste des refus ────────────────────────────────────────────────────────────────────────────

describe('les hypothèses de la conception, nommées', () => {
  it('rangent par la réalisation, et une contre-passation à sa date', () => {
    // [CO] point 6 : « la date de la prestation quand la facture la dit, sinon sa date d'émission » ; § 4.6 : « La
    // contre-passation d'un encaissement (d4) entre dans la période de SA date, en montant négatif (point 9) ».
    expect(HYPOTHESES_DE_LA_CONCEPTION).toEqual({ rangement: 'date_de_realisation', contrePassation: 'date_du_decaissement' })
  })
})

describe('les refus, dans leur ordre', () => {
  it('suivent l’ordre fixé : le statut, le champ et la période, les lectures, aujourd’hui, le déclarant, les opérations, le vide', () => {
    expect(REFUS_EREPORTING.map((r) => r.cle)).toEqual([
      'statut_a_preciser', 'paiements_sur_debits', 'periode_hors_regime', 'avant_l_obligation', 'lecture_incomplete',
      'periode_en_cours', 'regime_a_confirmer', 'siren_invalide', 'numero_tva_absent', 'lectures_discordantes',
      'fiche_a_revoir', 'achat_a_verifier', 'achat_avec_tva', 'destinataire_inconnu', 'facture_internationale',
      'nature_inconnue', 'facture_mixte', 'option_inconnue', 'montants_incoherents', 'taux_positif', 'zero_sans_article',
      'rien_a_declarer',
    ])
  })

  it('ne citent aucun article, et ne disent d’aucun dossier qu’il « n’y est pas tenu »', () => {
    // [CO] § 1.1 : « les écrans ne citeront aucun article » ; [E1] : le texte faux qui ne revient pas.
    const textes = [...REFUS_EREPORTING.map((r) => r.modele), ...Object.values(RAISONS_ECARTEES)]
    for (const t of textes) {
      expect(t).not.toMatch(/\bart\.|article \d/i)
      expect(t).not.toMatch(/pas tenu|seulement la réception|pas de déclaration à déposer/i)
    }
  })
})

// ── La période ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe('la période vient d’e1', () => {
  it('un statut de TVA à préciser ne donne aucune période, pour les trois déclarations', () => {
    const c = contexte({ dossier: dossier({ statut_tva: null }) })
    const message = 'Le statut de TVA du dossier est à préciser (onglet TVA) : le rythme de ses déclarations et ce qui y entre en dépendent.'
    for (const d of [declarationDesAchats(c, achats(), parFacture), declarationDesVentes(c, ventes(), parFacture),
      declarationDesPaiements(c, paiements(), parDecaissement)]) {
      expect(d.etat).toBe('incomplete')
      expect(d.refus).toEqual([{ cle: 'statut_a_preciser', message, sources: [] }])
      expect(d.contenu).toBeNull()
      expect(d.periode).toBeNull()
      expect(d.frequence).toBeNull()
    }
    // [E1] : les achats sont dus quel que soit le statut, le reste est à préciser.
    expect(declarationDesAchats(c, achats(), parFacture).obligation).toBe('due')
    expect(declarationDesVentes(c, ventes(), parFacture).obligation).toBe('a_preciser')
  })

  it('rend la période d’e1 : ses bornes, son échéance, son libellé', () => {
    // [M] § 60 et § 90 : au réel trimestriel, le mois, à déclarer au plus tard le 10 du mois suivant.
    const d = declarationDesVentes(contexte(), ventes(), parFacture)
    expect(d.periode).toMatchObject({ frequence: 'mois', debut: '2027-10-01', fin: '2027-10-31', echeance: '2027-11-10', libelle: 'octobre 2027' })
    expect(d.frequence).toEqual({ frequence: 'mois', certitude: 'ecrite', raison: null })
    expect(d.obligation).toBe('due')
  })

  it('refuse des bornes qui ne sont pas une période du régime d’aujourd’hui', () => {
    // [M] § 50 : au réel mensuel, les transactions par décade ; [P] § 170 : les paiements chaque mois.
    const mensuel = contexte({ dossier: dossier({ tva_periodicite: 'mensuelle' }) })
    const ventesDuMois = declarationDesVentes(mensuel, ventes(), parFacture)
    expect(ventesDuMois.etat).toBe('incomplete')
    expect(ventesDuMois.contenu).toBeNull()
    expect(ventesDuMois.refus).toEqual([{
      cle: 'periode_hors_regime', sources: [],
      message: 'Du 01/10/2027 au 31/10/2027 n’est pas une période de ses déclarations : sous son régime de TVA d’aujourd’hui, '
        + 'elles se font par décade. Une période se déclare sous le régime qu’elle avait, que l’application ne garde pas encore.',
    }])
    // La fréquence d'e1 se rend avec le refus : c'est elle que l'écran propose à la place.
    expect(ventesDuMois.frequence).toEqual({ frequence: 'decade', certitude: 'ecrite', raison: null })
    expect(ventesDuMois.periode).toBeNull()
    expect(cles(declarationDesAchats(mensuel, achats(), parFacture))).toEqual(['periode_hors_regime'])
    expect(declarationDesPaiements(mensuel, paiements(), parDecaissement).etat).toBe('a_declarer')
    // [E1] : la fréquence d'un exonéré se dit « à confirmer », sans sa raison dans ce refus.
    const exonere = contexte({ periode: SEPTEMBRE_OCTOBRE, dossier: dossier({ statut_tva: 'exonere' }) })
    expect(declarationDesAchats(exonere, achats(), parFacture).refus[0].message).toBe('Du 01/09/2027 au 31/10/2027 n’est pas '
      + 'une période de ses déclarations : sous son régime de TVA d’aujourd’hui, elles se font chaque mois (fréquence à '
      + 'confirmer). Une période se déclare sous le régime qu’elle avait, que l’application ne garde pas encore.')
    const decade = declarationDesVentes({ ...mensuel, periode: { debut: '2027-10-01', fin: '2027-10-10' } }, ventes(), parFacture)
    expect(decade.etat).toBe('a_declarer')
    // [M] § 90 et [E1] : la première décade se déclare au plus tard le 20.
    expect(decade.periode?.echeance).toBe('2027-10-20')
    // Une fin qui n'est pas celle de la période, une date qui n'en est pas une.
    expect(cles(declarationDesVentes(contexte({ periode: { debut: '2027-10-01', fin: '2027-10-30' } }), ventes(), parFacture)))
      .toEqual(['periode_hors_regime'])
    expect(cles(declarationDesVentes(contexte({ periode: { debut: '2027-10-02', fin: '2027-10-31' } }), ventes(), parFacture)))
      .toEqual(['periode_hors_regime'])
    expect(cles(declarationDesVentes(contexte({ periode: { debut: '2027-13-01', fin: '2027-13-31' } }), ventes(), parFacture)))
      .toEqual(['periode_hors_regime'])
  })

  it('met hors du champ une période finie avant le 1er septembre 2027', () => {
    // [P] § 1 et BOI-TVA-DECLA-20-30-50, § 10 : les factures du 1er septembre 2027 pour une PME.
    const aout = contexte({ periode: { debut: '2027-08-01', fin: '2027-08-31' }, aujourdHui: '2027-09-05' })
    const d = declarationDesVentes(aout, ventes({ factures: lu([facture({ date_emission: '2027-08-10' })]) }), parFacture)
    expect(d.etat).toBe('hors_du_champ')
    expect(d.contenu).toBeNull()
    expect(d.periode?.debut).toBe('2027-08-01')
    expect(d.refus).toEqual([{
      cle: 'avant_l_obligation', sources: [],
      message: 'La période finit le 31/08/2027, avant le 1er septembre 2027 : l’e-reporting d’une PME ou d’une '
        + 'micro-entreprise commence avec les factures de ce jour.',
    }])
    // Septembre est la première période.
    const septembre = contexte({ periode: { debut: '2027-09-01', fin: '2027-09-30' }, aujourdHui: '2027-10-05' })
    expect(declarationDesVentes(septembre, ventes({ factures: lu([facture({ date_emission: '2027-09-01' })]) }), parFacture).etat)
      .toBe('a_declarer')
  })

  it('met hors du champ les paiements d’un redevable sur option pour les débits, pas ceux d’un franchisé', () => {
    // [P] § 30 et [E1] : pas de données de paiement sur option pour les débits ; l'option ne regarde pas un franchisé.
    const debits = contexte({ dossier: dossier({ tva_sur_debits: true }) })
    const d = declarationDesPaiements(debits, paiements(), parDecaissement)
    expect(d.etat).toBe('hors_du_champ')
    expect(d.obligation).toBe('non_due')
    // e1 ne propose aucune fréquence à ce qui n'est pas dû : aucune période ne se juge, quelles qu'en soient les bornes.
    expect(d.frequence).toBeNull()
    expect(d.periode).toBeNull()
    expect(d.contenu).toBeNull()
    expect(cles(declarationDesPaiements({ ...debits, periode: SEPTEMBRE_OCTOBRE }, paiements(), parDecaissement)))
      .toEqual(['paiements_sur_debits'])
    expect(d.refus).toEqual([{
      cle: 'paiements_sur_debits', sources: [],
      message: 'Sur option pour les débits, la TVA de ses prestations est due à la facture : le dossier n’a pas de données de '
        + 'paiement à transmettre.',
    }])
    expect(declarationDesVentes(debits, ventes(), parFacture).etat).toBe('a_declarer')
    const franchise = contexte({
      periode: SEPTEMBRE_OCTOBRE, dossier: dossier({ statut_tva: 'franchise', tva_sur_debits: true }),
    })
    const p = declarationDesPaiements(franchise, paiements({ parts: lu([part({ taux: 0 })]) }), parDecaissement)
    expect(p.etat).toBe('a_declarer')
  })

  it('dit la période pas finie le jour de sa fin, et plus le lendemain — à Paris', () => {
    // [A7] G7.43 : la fin de période est antérieure à la date du contrôle.
    const leDernierJour = declarationDesVentes(contexte({ aujourdHui: '2027-10-31' }), ventes(), parFacture)
    expect(leDernierJour.refus).toEqual([{
      cle: 'periode_en_cours', sources: [],
      message: 'La période n’est pas finie : elle se déclare à partir du 01/11/2027, au plus tard le 10/11/2027.',
    }])
    // L'état dit le contenu : une période en cours a déjà de quoi déclarer.
    expect(leDernierJour.etat).toBe('a_declarer')
    expect(declarationDesVentes(contexte({ aujourdHui: '2027-11-01' }), ventes(), parFacture).refus).toEqual([])
    expect(cles(declarationDesVentes(contexte({ aujourdHui: '2027-10-01' }), ventes(), parFacture))).toEqual(['periode_en_cours'])
  })

  it('refuse un régime que le cabinet n’a pas confirmé, sans changer l’état', () => {
    // [CO] § 4.3 : « régime d'e-reporting à confirmer » ; [E1] : la fréquence d'un exonéré, à confirmer.
    const d = declarationDesVentes(contexte({ regimeConfirme: false }), ventes(), parFacture)
    expect(d.etat).toBe('a_declarer')
    expect(d.refus).toEqual([{
      cle: 'regime_a_confirmer', sources: [],
      message: 'Le rythme de ses déclarations — chaque mois — est proposé par l’application : le cabinet le confirme, tel '
        + 'que le dossier l’a déclaré à sa plateforme, avant toute déclaration.',
    }])
    const exonere = contexte({ regimeConfirme: false, dossier: dossier({ statut_tva: 'exonere', numero_tva_attribue: true }) })
    const a = declarationDesAchats(exonere, achats(), parFacture)
    expect(a.refus[0].message).toBe('Le rythme de ses déclarations — chaque mois (fréquence à confirmer : les textes ne la '
      + 'disent pas pour un dossier exonéré ; celle du réel normal trimestriel est proposée, à confirmer avec son service des '
      + 'impôts) — est proposé par l’application : le cabinet le confirme, tel que le dossier l’a déclaré à sa plateforme, '
      + 'avant toute déclaration.')
    expect(a.frequence?.certitude).toBe('a_confirmer')
  })
})

// ── Les lectures ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('une lecture partielle ne déclare rien, ni ne dit le vide', () => {
  const motif = '12 ligne(s) lue(s) sur 15 annoncée(s)'

  it('pour chaque source de chaque déclaration, avec son nom et son motif', () => {
    const cas: [string, () => { etat: string; contenu: unknown; refus: { cle: string; message: string; sources: unknown }[] }, string][] = [
      ['pieces', () => declarationDesAchats(contexte(), achats({ pieces: luEnPartie([piece()], motif) }), parFacture), 'des pièces du dossier'],
      ['fiches', () => declarationDesAchats(contexte(), achats({ fiches: luEnPartie([], motif) }), parFacture),
        'des fiches « fournisseur établi hors de France »'],
      ['taux', () => declarationDesAchats(contexte(), achats({ taux: luEnPartie([], motif) }), parFacture), 'de la ventilation des fiches'],
      ['textes', () => declarationDesAchats(contexte(), achats({ textes: luEnPartie([], motif) }), parFacture),
        'des textes lus sur les documents'],
      ['factures', () => declarationDesVentes(contexte(), ventes({ factures: luEnPartie([], motif) }), parFacture), 'des factures émises'],
      ['lignes', () => declarationDesVentes(contexte(), ventes({ lignes: luEnPartie([], motif) }), parFacture), 'des lignes des factures'],
      ['factures', () => declarationDesPaiements(contexte(), paiements({ factures: luEnPartie([], motif) }), parDecaissement),
        'des factures émises'],
      ['encaissements', () => declarationDesPaiements(contexte(), paiements({ encaissements: luEnPartie([], motif) }), parDecaissement),
        'des encaissements'],
      ['parts', () => declarationDesPaiements(contexte(), paiements({ parts: luEnPartie([], motif) }), parDecaissement),
        'de la répartition des encaissements par taux'],
    ]
    for (const [id, declarer, nom] of cas) {
      const d = declarer()
      expect(d.etat, id).toBe('incomplete')
      expect(d.contenu, id).toBeNull()
      expect(d.refus, id).toEqual([{
        cle: 'lecture_incomplete', sources: [{ genre: 'lecture', id }],
        message: `La lecture ${nom} n’est pas revenue entière (${motif}) : rien ne se déclare, ni ne se dit vide, sur une lecture partielle.`,
      }])
    }
  })

  it('dit chaque lecture partielle, dans l’ordre des sources, et ne la juge qu’après la période', () => {
    const d = declarationDesAchats(contexte(), achats({ fiches: luEnPartie([], 'a'), textes: luEnPartie([], 'b') }), parFacture)
    expect(d.refus.map((r) => r.sources)).toEqual([[{ genre: 'lecture', id: 'fiches' }], [{ genre: 'lecture', id: 'textes' }]])
    const statutInconnu = contexte({ dossier: dossier({ statut_tva: null }) })
    expect(cles(declarationDesVentes(statutInconnu, ventes({ factures: luEnPartie([], 'a') }), parFacture))).toEqual(['statut_a_preciser'])
    const avant = contexte({ periode: { debut: '2027-08-01', fin: '2027-08-31' } })
    expect(cles(declarationDesVentes(avant, ventes({ factures: luEnPartie([], 'a') }), parFacture))).toEqual(['avant_l_obligation'])
  })

  it('rend un motif quand la lecture n’en a pas donné', () => {
    const d = declarationDesVentes(contexte(), ventes({ lignes: { lignes: [], complete: false, motif: null } }), parFacture)
    expect(d.refus[0].message).toContain('(sans motif rendu)')
  })
})

// ── Les achats à un fournisseur établi hors de France ───────────────────────────────────────────────────────────────

describe('les achats : les fiches d’e2, telles que la base les garde', () => {
  it('déclarent la fiche courante, le dossier en acheteur', () => {
    const d = declarationDesAchats(contexte(), achats(), parFacture)
    expect(d.etat).toBe('a_declarer')
    expect(d.refus).toEqual([])
    expect(d.ecartees).toEqual([])
    // [A6] TT-15 : BY, le déclarant acheteur ; [A7] G2.33 : son SIREN et son numéro de TVA ; G1.02 : S1 pour des
    // services ; [T] § 70 : sans les lignes de la facture ; G6.23 : la TVA en euros.
    expect(d.contenu).toEqual({
      role: 'BY', siren: SIREN, numeroTva: NUMERO_TVA, nombreOperations: 1, totauxParDevise: [{ devise: 'EUR', htCentimes: 12000 }],
      achats: [{
        ficheId: 'f1', pieceId: 'p1', date: '2027-10-05', numero: 'INV-1', dateFacture: '2027-10-05', typeDocument: '380',
        origine: null, devise: 'EUR', pays: 'IE', schema: '0223', identifiant: 'IE6388047V', nature: 'services', cadre: 'S1',
        autoliquidation: true, dateOperation: null, periodeDebut: null, periodeFin: null,
        lignes: [{ code: 'AE', taux: 0, baseCentimes: 12000, tvaCentimes: 0, motifCode: null, motifTexte: null }],
        htCentimes: 12000, tvaEurosCentimes: 0,
      }],
    })
  })

  it('rangent une facture du premier et du dernier jour, pas de la veille ni du lendemain', () => {
    const avecDate = (date: string) => declarationDesAchats(contexte(), achats({ fiches: lu([fiche({ date_facture: date })]) }), parFacture)
    expect(avecDate('2027-10-01').contenu?.nombreOperations).toBe(1)
    expect(avecDate('2027-10-31').contenu?.nombreOperations).toBe(1)
    // La pièce garde sa fiche : elle n'est pas candidate, la période est vide.
    expect(avecDate('2027-09-30').etat).toBe('rien_a_declarer')
    expect(avecDate('2027-11-01').etat).toBe('rien_a_declarer')
  })

  it('rangent par la réalisation ou par la facture, selon le choix — un avoir à sa date', () => {
    // [DG] note 125 : la date de réalisation ; [CO] point 6.
    const livree = fiche({ date_facture: '2027-09-28', date_operation: '2027-10-02' })
    expect(dateQuiRangeLAchat(livree, 'date_de_realisation')).toBe('2027-10-02')
    expect(dateQuiRangeLAchat(livree, 'date_de_la_facture')).toBe('2027-09-28')
    const periodique = fiche({ date_facture: '2027-09-28', periode_debut: '2027-10-01', periode_fin: '2027-10-31' })
    expect(dateQuiRangeLAchat(periodique, 'date_de_realisation')).toBe('2027-10-31')
    expect(dateQuiRangeLAchat(fiche({ date_facture: '2027-09-28' }), 'date_de_realisation')).toBe('2027-09-28')
    expect(dateQuiRangeLAchat(fiche({ type_document: '381', date_facture: '2027-11-03', date_operation: '2027-10-02' }),
      'date_de_realisation')).toBe('2027-11-03')
    const s = achats({ fiches: lu([livree]), pieces: lu([piece({ date_piece: '2027-09-28' })]) })
    expect(declarationDesAchats(contexte(), s, parRealisation).contenu?.achats[0].date).toBe('2027-10-02')
    expect(declarationDesAchats(contexte(), s, parFacture).etat).toBe('rien_a_declarer')
    expect(declarationDesAchats(contexte({ periode: { debut: '2027-09-01', fin: '2027-09-30' } }), s, parFacture)
      .contenu?.nombreOperations).toBe(1)
  })

  it('écartent une facture antérieure au 1er septembre 2027, même réalisée après', () => {
    // [P] § 1, BOI-TVA-DECLA-20-30-50, § 10 : la facture décide.
    const s = achats({ fiches: lu([fiche({ date_facture: '2027-08-30', date_operation: '2027-10-02' })]) })
    const d = declarationDesAchats(contexte(), s, parRealisation)
    expect(d.ecartees).toEqual([{ source: { genre: 'fiche', id: 'f1' }, raison: 'avant_l_obligation' }])
    expect(d.etat).toBe('rien_a_declarer')
    expect(d.refus).toEqual([{ cle: 'rien_a_declarer', sources: [], message: 'Aucune opération sur la période : aucune transmission n’est attendue.' }])
  })

  it('ne déclarent que la version courante, et rien d’une fiche retirée', () => {
    const v1 = fiche({ id: 'f1', numero: 'INV-1' })
    const v2 = fiche({ id: 'f2', remplace_id: 'f1', numero: 'INV-2' })
    const s = achats({ fiches: lu([v2, v1]), taux: lu([taux({ fiche_id: 'f1' }), taux({ fiche_id: 'f2' })]) })
    expect(declarationDesAchats(contexte(), s, parFacture).contenu?.achats.map((a) => a.numero)).toEqual(['INV-2'])
    // [E2] : une fiche retirée dit que la pièce n'était pas un achat à l'étranger — ni déclarée, ni candidate.
    const retiree = achats({ fiches: lu([v1, { ...v2, retire_le: '2027-10-20T08:00:00Z' }]), pieces: lu([piece({ devise: 'USD', montant_devise: 130 })]) })
    const d = declarationDesAchats(contexte(), retiree, parFacture)
    expect(d.etat).toBe('rien_a_declarer')
    expect(d.contenu?.achats).toEqual([])
  })

  it('rejugent la fiche contre la pièce d’aujourd’hui, sous les mots de la base', () => {
    // [E3] : la base ne revoit pas une fiche quand sa pièce change ; [E2] : les mots de ses refus.
    const rejugee = (p: PieceLue) => declarationDesAchats(contexte(), achats({ pieces: lu([p]) }), parFacture)
    const ttc = rejugee(piece({ montant_ttc: 130 }))
    expect(ttc.etat).toBe('incomplete')
    expect(ttc.contenu?.achats).toEqual([])
    expect(ttc.refus).toEqual([{
      cle: 'fiche_a_revoir', sources: [{ genre: 'fiche', id: 'f1' }, { genre: 'piece', id: 'p1' }],
      message: 'Telle qu’enregistrée, la fiche « fournisseur établi hors de France » d’une pièce ne passerait plus les '
        + 'contrôles de la base : La ventilation (120,00 EUR) ne fait pas le montant TTC de la pièce (130,00 EUR), à un '
        + 'centime près. Corrigez-la avant de déclarer.',
    }])
    expect(rejugee(piece({ type_piece: 'vente' })).refus[0].message).toContain(
      'Seule une pièce d\'achat ou une note de frais reçoit une fiche « fournisseur établi hors de France ».')
    expect(rejugee(piece({ montant_tva: 5 })).refus[0].message).toContain(
      'La pièce porte une TVA de 5,00 € : un achat à un fournisseur établi hors de France facturé avec une TVA')
    // Une note de frais reçoit une fiche.
    expect(rejugee(piece({ type_piece: 'note_frais' })).etat).toBe('a_declarer')
  })

  it('disent des lectures qui se contredisent : une fiche sans sa pièce, sans sa ventilation', () => {
    const sansPiece = declarationDesAchats(contexte(), achats({ pieces: lu([]) }), parFacture)
    expect(sansPiece.refus).toEqual([{
      cle: 'lectures_discordantes', sources: [{ genre: 'fiche', id: 'f1' }],
      message: 'Ce qui a été lu ne concorde pas — une fiche « hors de France » sans sa pièce : relisez.',
    }])
    expect(sansPiece.etat).toBe('incomplete')
    expect(declarationDesAchats(contexte(), achats({ taux: lu([]) }), parFacture).refus[0].message)
      .toBe('Ce qui a été lu ne concorde pas — une fiche « hors de France » sans sa ventilation : relisez.')
  })

  it('totalisent par devise, un avoir en moins', () => {
    const usd = piece({ id: 'p2', devise: 'USD', montant_ttc: -46, montant_devise: -50, date_piece: '2027-10-12' })
    const avoir = fiche({
      id: 'f2', piece_id: 'p2', type_document: '381', numero: 'CN-7', date_facture: '2027-10-12', devise: 'USD', pays: 'US',
      schema_identifiant: '0227', identifiant: 'USEditeur Logiciel', facture_origine_numero: 'INV-0', facture_origine_date: '2027-09-12',
    })
    const s = achats({
      pieces: lu([piece(), usd]), fiches: lu([fiche(), avoir]), taux: lu([taux(), taux({ fiche_id: 'f2', base: 50 })]),
    })
    const d = declarationDesAchats(contexte(), s, parFacture)
    expect(d.refus).toEqual([])
    expect(d.contenu?.totauxParDevise).toEqual([{ devise: 'EUR', htCentimes: 12000 }, { devise: 'USD', htCentimes: -5000 }])
    // [A6] TT-21 : 381 pour un avoir, ses montants positifs ([CO] point 21) ; TG-11 : la facture qu'il corrige.
    const a = d.contenu?.achats.find((x) => x.ficheId === 'f2')
    expect(a).toMatchObject({ typeDocument: '381', htCentimes: 5000, origine: { numero: 'INV-0', date: '2027-09-12' }, cadre: 'S1' })
  })

  it('se rangent par date puis par identifiant, les devises dans l’ordre de leur code', () => {
    const usd = piece({ id: 'p2', devise: 'USD', montant_ttc: 92, montant_devise: 100, date_piece: '2027-10-02' })
    const ficheUsd = fiche({
      id: 'f2', piece_id: 'p2', date_facture: '2027-10-02', devise: 'USD', pays: 'US', schema_identifiant: '0227',
      identifiant: 'USAgence', numero: 'US-1',
    })
    const memeJour = fiche({ id: 'f0', piece_id: 'p0', numero: 'INV-0' })
    const s = achats({
      pieces: lu([piece(), usd, piece({ id: 'p0' })]),
      fiches: lu([fiche(), ficheUsd, memeJour]),
      taux: lu([taux(), taux({ fiche_id: 'f2', base: 100 }), taux({ fiche_id: 'f0' })]),
    })
    const d = declarationDesAchats(contexte(), s, parFacture)
    expect(d.refus).toEqual([])
    expect(d.contenu?.achats.map((a) => a.ficheId)).toEqual(['f2', 'f0', 'f1'])
    expect(d.contenu?.totauxParDevise).toEqual([{ devise: 'EUR', htCentimes: 24000 }, { devise: 'USD', htCentimes: 10000 }])
  })

  it('donnent le cadre des biens et d’une facture double', () => {
    // [A7] G1.02 : B1 des biens, M1 une facture double.
    const avecNature = (nature: 'biens' | 'mixte') =>
      declarationDesAchats(contexte(), achats({ fiches: lu([fiche({ nature })]) }), parFacture).contenu?.achats[0].cadre
    expect(avecNature('biens')).toBe('B1')
    expect(avecNature('mixte')).toBe('M1')
  })
})

describe('les achats : une pièce candidate attend sa fiche', () => {
  // Un autre fournisseur que celui de la fiche p1 : son seul signal est sa devise.
  const usd = (o: Partial<PieceLue> = {}) =>
    piece({ id: 'p9', tiers: 'Agence Publicite', devise: 'USD', montant_ttc: 92, montant_devise: 100, ...o })

  it('rend la déclaration incomplète, sous ses signaux', () => {
    // [CO] § 4.2 : « À vérifier : 1 pièce d'achat ressemble à un achat à l'étranger » ; [E3] : le signal de la devise.
    const d = declarationDesAchats(contexte(), achats({ pieces: lu([piece(), usd()]) }), parFacture)
    expect(d.etat).toBe('incomplete')
    expect(d.contenu?.nombreOperations).toBe(1)
    expect(d.refus).toEqual([{
      cle: 'achat_a_verifier', sources: [{ genre: 'piece', id: 'p9' }],
      message: 'Une pièce d’achat sans fiche ressemble à un achat à un fournisseur établi hors de France. Le document est en '
        + 'USD. Sa fiche est à saisir, ou la pièce à écarter.',
    }])
  })

  it('jamais « rien à déclarer » tant qu’une candidate attend, même sans aucune fiche', () => {
    const d = declarationDesAchats(contexte(), achats({ pieces: lu([usd()]), fiches: lu([]), taux: lu([]) }), parFacture)
    expect(d.etat).toBe('incomplete')
    expect(cles(d)).toEqual(['achat_a_verifier'])
  })

  it('met de côté un achat facturé avec une TVA, à trancher par le cabinet', () => {
    // [E2] hypothèse Q7.
    const d = declarationDesAchats(contexte(), achats({ pieces: lu([usd({ montant_tva: 12.5 })]), fiches: lu([]), taux: lu([]) }), parFacture)
    expect(d.refus).toEqual([{
      cle: 'achat_avec_tva', sources: [{ genre: 'piece', id: 'p9' }],
      message: 'Une pièce d’achat qui ressemble à un achat à l’étranger porte une TVA de 12,50 € : un achat à un fournisseur '
        + 'établi hors de France facturé avec une TVA est mis de côté, à trancher par le cabinet.',
    }])
    // Une TVA négative — un avoir — se dit en valeur absolue, comme la base l'écrit ([E2], refus 6).
    expect(declarationDesAchats(contexte(), achats({ pieces: lu([usd({ montant_tva: -3 })]), fiches: lu([]), taux: lu([]) }), parFacture)
      .refus[0].message).toContain('porte une TVA de 3,00 € :')
    expect(cles(declarationDesAchats(contexte(), achats({ pieces: lu([usd({ montant_tva: 0 })]), fiches: lu([]), taux: lu([]) }), parFacture)))
      .toEqual(['achat_a_verifier'])
  })

  it('n’attend plus une fois écartée par le cabinet', () => {
    const d = declarationDesAchats(contexte(), achats({ pieces: lu([usd()]), fiches: lu([]), taux: lu([]) }),
      { rangement: 'date_de_la_facture', piecesEcartees: new Set(['p9']) })
    expect(d.etat).toBe('rien_a_declarer')
    expect(d.ecartees).toEqual([{ source: { genre: 'piece', id: 'p9' }, raison: 'ecartee_par_le_cabinet' }])
  })

  it('attend dans toute période quand elle n’a pas de date, dans la sienne seulement sinon', () => {
    const sansDate = achats({ pieces: lu([usd({ date_piece: null })]), fiches: lu([]), taux: lu([]) })
    expect(cles(declarationDesAchats(contexte(), sansDate, parFacture))).toEqual(['achat_a_verifier'])
    expect(cles(declarationDesAchats(contexte({ periode: NOVEMBRE, aujourdHui: '2027-12-02' }), sansDate, parFacture)))
      .toEqual(['achat_a_verifier'])
    const datee = (date: string) => cles(declarationDesAchats(contexte(), achats({ pieces: lu([usd({ date_piece: date })]), fiches: lu([]), taux: lu([]) }), parFacture))
    expect(datee('2027-10-01')).toEqual(['achat_a_verifier'])
    expect(datee('2027-10-31')).toEqual(['achat_a_verifier'])
    expect(datee('2027-09-30')).toEqual(['rien_a_declarer'])
    expect(datee('2027-11-01')).toEqual(['rien_a_declarer'])
  })

  it('ne retient qu’un achat ou une note de frais, sans fiche, et qu’un signal désigne', () => {
    const seule = (p: PieceLue, s: Partial<SourcesDesAchats> = {}) =>
      cles(declarationDesAchats(contexte(), achats({ pieces: lu([p]), fiches: lu([]), taux: lu([]), ...s }), parFacture))
    expect(seule(usd({ type_piece: 'vente' }))).toEqual(['rien_a_declarer'])
    expect(seule(usd({ type_piece: 'autre' }))).toEqual(['rien_a_declarer'])
    expect(seule(usd({ type_piece: 'note_frais' }))).toEqual(['achat_a_verifier'])
    expect(seule(piece({ id: 'p9' }))).toEqual(['rien_a_declarer'])
    // [E3] : une mention d'autoliquidation, un numéro de TVA de l'Union lus dans le texte stocké.
    const mention = seule(piece({ id: 'p9' }), { textes: lu([{ piece_id: 'p9', texte: 'Total 120.00\nReverse charge - VAT due by the customer' }]) })
    expect(mention).toEqual(['achat_a_verifier'])
    const d = declarationDesAchats(contexte(), achats({
      pieces: lu([piece({ id: 'p9' })]), fiches: lu([]), taux: lu([]), textes: lu([{ piece_id: 'p9', texte: 'USt-IdNr. DE123456789' }]),
    }), parFacture)
    expect(d.refus[0].message).toContain('numéro de TVA')
    // Le texte d'un document (sans pièce) ou d'une autre pièce ne désigne rien.
    expect(seule(piece({ id: 'p9' }), { textes: lu([{ piece_id: null, texte: 'Reverse charge' }, { piece_id: 'p8', texte: 'Reverse charge' }]) }))
      .toEqual(['rien_a_declarer'])
  })

  it('reconnaît un fournisseur déjà décrit dans le dossier', () => {
    // [E3] : « Ce fournisseur a déjà une fiche « hors de France » dans ce dossier ».
    const autre = piece({ id: 'p9', date_piece: '2027-10-20' })
    const d = declarationDesAchats(contexte(), achats({ pieces: lu([piece(), autre]) }), parFacture)
    expect(cles(d)).toEqual(['achat_a_verifier'])
    expect(d.refus[0].sources).toEqual([{ genre: 'piece', id: 'p9' }])
    expect(d.refus[0].message).toContain('Ce fournisseur a déjà une fiche « hors de France » dans ce dossier (pièce du 05/10/2027).')
    // Deux signaux se suivent, chacun sa phrase.
    const deux = declarationDesAchats(contexte(), achats({ pieces: lu([piece(), { ...autre, devise: 'USD', montant_devise: 140 }]) }), parFacture)
    expect(deux.refus[0].message).toContain('Le document est en USD. Ce fournisseur a déjà une fiche')
  })

  it('dit deux candidates d’un même jour dans l’ordre de leur identifiant', () => {
    const s = achats({
      pieces: lu([usd({ id: 'p9' }), usd({ id: 'p8' }), usd({ id: 'p7', date_piece: '2027-10-04' })]), fiches: lu([]), taux: lu([]),
    })
    expect(declarationDesAchats(contexte(), s, parFacture).refus.map((r) => r.sources[0].id)).toEqual(['p7', 'p8', 'p9'])
  })
})

describe('les achats : le dossier en acheteur', () => {
  it('exigent le numéro de TVA d’un franchisé ou d’un exonéré, pas d’un redevable', () => {
    // [A7] G2.33 ; [CO] Q3 : l'application refuse de préparer ses achats sans la case du numéro de TVA.
    const sansNumero = contexte({ periode: SEPTEMBRE_OCTOBRE, dossier: dossier({ statut_tva: 'franchise' }) })
    const d = declarationDesAchats(sansNumero, achats(), parFacture)
    expect(d.etat).toBe('incomplete')
    expect(d.refus).toEqual([{
      cle: 'numero_tva_absent', sources: [],
      message: 'Le dossier n’a pas de numéro de TVA : un assujetti qui achète un service à un prestataire établi hors de '
        + 'France en demande un au service des impôts pour autoliquider la TVA ; cochez ensuite la case de l’onglet TVA.',
    }])
    expect(d.contenu?.numeroTva).toBeNull()
    const avecNumero = declarationDesAchats({ ...sansNumero, dossier: dossier({ statut_tva: 'franchise', numero_tva_attribue: true }) }, achats(), parFacture)
    expect(avecNumero.etat).toBe('a_declarer')
    expect(avecNumero.contenu?.numeroTva).toBe(NUMERO_TVA)
    // Rien à déclarer : rien à exiger.
    expect(cles(declarationDesAchats(sansNumero, achats({ fiches: lu([]), taux: lu([]) }), parFacture))).toEqual(['rien_a_declarer'])
    // Les ventes d'un franchisé ne portent pas son numéro de TVA (bloc 10.3).
    const v = declarationDesVentes(sansNumero, ventes({ lignes: lu([ligne({ taux_tva: 0 })]), factures: lu([facture({ montant_tva: 0, montant_ttc: 100 })]) }), parFacture)
    expect(v.refus).toEqual([])
  })

  it('déclarent les achats d’un dossier exonéré : il y est tenu', () => {
    // [C] § 60 : tout assujetti établi en France, exonéré compris ; [E1].
    const exonere = contexte({ dossier: dossier({ statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1', numero_tva_attribue: true }) })
    const d = declarationDesAchats(exonere, achats(), parFacture)
    expect(d.obligation).toBe('due')
    expect(d.etat).toBe('a_declarer')
    expect(d.contenu?.numeroTva).toBe(NUMERO_TVA)
  })

  it('exigent un SIREN valide dès qu’il y a de quoi déclarer', () => {
    // [A7] G6.26 : le SIREN du déclarant, neuf chiffres, connu de l'INSEE.
    for (const siret of [null, '12345678', '12345678300010']) {
      const d = declarationDesAchats(contexte({ dossier: dossier({ siret }) }), achats(), parFacture)
      expect(d.refus, String(siret)).toEqual([{
        cle: 'siren_invalide', sources: [],
        message: 'Le SIRET du dossier ne donne pas un SIREN valide (neuf chiffres et leur clé) : une déclaration se fait au '
          + 'SIREN du dossier.',
      }])
      expect(d.contenu?.siren).toBeNull()
      expect(d.contenu?.numeroTva).toBeNull()
    }
    expect(declarationDesAchats(contexte({ dossier: dossier({ siret: SIREN }) }), achats(), parFacture).contenu?.siren).toBe(SIREN)
    expect(cles(declarationDesVentes(contexte({ dossier: dossier({ siret: null }) }), ventes(), parFacture))).toEqual(['siren_invalide'])
    expect(cles(declarationDesPaiements(contexte({ dossier: dossier({ siret: null }) }), paiements(), parDecaissement))).toEqual(['siren_invalide'])
    // Le SIREN se dit aussi devant une opération refusée — elle sera déclarée.
    expect(cles(declarationDesVentes(contexte({ dossier: dossier({ siret: null }) }), ventes({ factures: lu([facture({ type_client: null })]) }), parFacture)))
      .toEqual(['siren_invalide', 'destinataire_inconnu'])
    expect(cles(declarationDesVentes(contexte({ dossier: dossier({ siret: null }) }), ventes({ factures: lu([]) }), parFacture)))
      .toEqual(['rien_a_declarer'])
  })

  it('ignorent ce qui n’est pas du dossier', () => {
    // Des lignes d'un autre dossier glissées dans les lectures : une fiche lue AVANT celle de la pièce, une ventilation
    // de même clé que la sienne, une pièce étrangère qui serait candidate.
    const s = achats({
      pieces: lu([piece(), piece({ id: 'pX', dossier_id: 'd2', devise: 'USD', montant_devise: 9 })]),
      fiches: lu([fiche({ id: 'fX', dossier_id: 'd2', piece_id: 'p1', numero: 'X-1' }), fiche()]),
      taux: lu([taux({ dossier_id: 'd2', base: 5 }), taux(), taux({ fiche_id: 'fX', dossier_id: 'd2' })]),
    })
    const d = declarationDesAchats(contexte(), s, parFacture)
    expect(d.refus).toEqual([])
    expect(d.contenu?.achats.map((a) => a.ficheId)).toEqual(['f1'])
  })
})

// ── Les ventes à des particuliers ───────────────────────────────────────────────────────────────────────────────────

describe('les ventes : les factures émises à des particuliers, par jour', () => {
  it('agrègent une facture de services en TPS1, le dossier en vendeur', () => {
    // [A6] TT-15 : SE ; [A7] G1.68 : TPS1 des prestations de services ; [T] § 60 : par jour, par taux, HT et TVA en euros.
    const d = declarationDesVentes(contexte(), ventes(), parFacture)
    expect(d.etat).toBe('a_declarer')
    expect(d.contenu).toEqual({
      role: 'SE', siren: SIREN, nombreOperations: 1, htCentimes: 10000, tvaCentimes: 2000,
      transactions: [{
        date: '2027-10-08', devise: 'EUR', categorie: 'TPS1', optionDebits: false, htCentimes: 10000, tvaCentimes: 2000,
        parTaux: [{ taux: 20, baseCentimes: 10000, tvaCentimes: 2000 }], factures: ['v1'],
      }],
    })
  })

  it('séparent les jours, les catégories et l’option ; réunissent le reste, les taux du plus fort au plus faible', () => {
    // [A7] G1.68 : TLB1 des biens ; [A6] TT-80 : l'option pour les débits, sur des services (G1.67), jamais des biens.
    const s = ventes({
      factures: lu([
        facture({ id: 'v1' }),
        facture({ id: 'v2', montant_ht: 200, montant_tva: 21, montant_ttc: 221 }),
        facture({ id: 'v3', nature_operation: 'biens', montant_ht: 50, montant_tva: 10, montant_ttc: 60 }),
        facture({ id: 'v4', option_debits: true }),
        facture({ id: 'v5', nature_operation: 'biens', option_debits: true, montant_ht: 50, montant_tva: 10, montant_ttc: 60 }),
        facture({ id: 'v6', date_emission: '2027-10-09' }),
      ]),
      lignes: lu([
        ligne({ facture_id: 'v1' }),
        ligne({ facture_id: 'v2', prix_unitaire_ht: 100, taux_tva: 20 }), ligne({ facture_id: 'v2', ordre: 1, prix_unitaire_ht: 10, taux_tva: 10 }),
        ligne({ facture_id: 'v2', ordre: 2, prix_unitaire_ht: 90, taux_tva: 0 }),
        ligne({ facture_id: 'v3', prix_unitaire_ht: 50 }), ligne({ facture_id: 'v4' }), ligne({ facture_id: 'v5', prix_unitaire_ht: 50 }),
        ligne({ facture_id: 'v6' }),
      ]),
    })
    // La ligne à 0 % d'un redevable sans article serait une inconnue : la facture v2 la porte, elle se refuse.
    const sansArticle = declarationDesVentes(contexte(), s, parFacture)
    expect(sansArticle.refus).toEqual([{
      cle: 'zero_sans_article', sources: [{ genre: 'facture', id: 'v2' }],
      message: 'Une ligne à 0 % d’un dossier redevable demande l’article de son exonération (onglet TVA) : sans lui, on ne '
        + 'sait pas si elle se déclare.',
    }])
    // Avec l'article, la part à 0 % est exonérée : elle sort, le reste entre ([C] § 20).
    const d = declarationDesVentes(contexte({ dossier: dossier({ article_exoneration: 'cgi_261_4_1' }) }), s, parFacture)
    expect(d.refus).toEqual([])
    expect(d.ecartees).toEqual([{ source: { genre: 'facture', id: 'v2' }, raison: 'part_exoneree' }])
    expect(d.contenu?.transactions).toEqual([
      {
        date: '2027-10-08', devise: 'EUR', categorie: 'TLB1', optionDebits: false, htCentimes: 10000, tvaCentimes: 2000,
        parTaux: [{ taux: 20, baseCentimes: 10000, tvaCentimes: 2000 }], factures: ['v3', 'v5'],
      },
      {
        date: '2027-10-08', devise: 'EUR', categorie: 'TPS1', optionDebits: false, htCentimes: 21000, tvaCentimes: 4100,
        parTaux: [{ taux: 20, baseCentimes: 20000, tvaCentimes: 4000 }, { taux: 10, baseCentimes: 1000, tvaCentimes: 100 }],
        factures: ['v1', 'v2'],
      },
      {
        date: '2027-10-08', devise: 'EUR', categorie: 'TPS1', optionDebits: true, htCentimes: 10000, tvaCentimes: 2000,
        parTaux: [{ taux: 20, baseCentimes: 10000, tvaCentimes: 2000 }], factures: ['v4'],
      },
      {
        date: '2027-10-09', devise: 'EUR', categorie: 'TPS1', optionDebits: false, htCentimes: 10000, tvaCentimes: 2000,
        parTaux: [{ taux: 20, baseCentimes: 10000, tvaCentimes: 2000 }], factures: ['v6'],
      },
    ])
    expect(d.contenu?.nombreOperations).toBe(6)
    expect(d.contenu?.htCentimes).toBe(51000)
    expect(d.contenu?.tvaCentimes).toBe(10100)
  })

  it('mettent le plus fort taux d’abord, même entré le second', () => {
    const s = ventes({
      factures: lu([facture({ id: 'v1', montant_tva: 10, montant_ttc: 110 }), facture({ id: 'v2' })]),
      lignes: lu([ligne({ facture_id: 'v1', taux_tva: 10 }), ligne({ facture_id: 'v2' })]),
    })
    expect(declarationDesVentes(contexte(), s, parFacture).contenu?.transactions[0].parTaux)
      .toEqual([{ taux: 20, baseCentimes: 10000, tvaCentimes: 2000 }, { taux: 10, baseCentimes: 10000, tvaCentimes: 1000 }])
  })

  it('mettent un même jour sans l’option avant avec l’option, quel que soit l’ordre des factures', () => {
    const s = ventes({
      factures: lu([facture({ id: 'v0', option_debits: true }), facture({ id: 'v1' })]),
      lignes: lu([ligne({ facture_id: 'v0' }), ligne({ facture_id: 'v1' })]),
    })
    expect(declarationDesVentes(contexte(), s, parFacture).contenu?.transactions.map((t) => [t.optionDebits, t.factures]))
      .toEqual([[false, ['v1']], [true, ['v0']]])
  })

  it('comptent un avoir en moins, à sa date — jamais à la date de prestation qu’il reprend', () => {
    // [CO] point 21 : un agrégat que les avoirs réduisent ; [E1]/[CO] Q6 : un avoir ne rouvre pas la période corrigée.
    const avoir = facture({
      id: 'a1', type: 'avoir', date_emission: '2027-10-08', montant_ht: -40, montant_tva: -8, montant_ttc: -48,
      date_prestation: '2027-09-15',
    })
    const s = ventes({
      factures: lu([facture(), avoir]),
      lignes: lu([ligne(), ligne({ facture_id: 'a1', quantite: -1, prix_unitaire_ht: 40 })]),
    })
    const d = declarationDesVentes(contexte(), s, parRealisation)
    expect(d.contenu?.transactions).toEqual([{
      date: '2027-10-08', devise: 'EUR', categorie: 'TPS1', optionDebits: false, htCentimes: 6000, tvaCentimes: 1200,
      parTaux: [{ taux: 20, baseCentimes: 6000, tvaCentimes: 1200 }], factures: ['a1', 'v1'],
    }])
    expect(dateQuiRangeLaVente(avoir, 'date_de_realisation')).toBe('2027-10-08')
    // Un avoir seul, un jour : l'agrégat est négatif.
    const seul = declarationDesVentes(contexte(), ventes({ factures: lu([avoir]), lignes: lu([ligne({ facture_id: 'a1', quantite: -1, prix_unitaire_ht: 40 })]) }), parFacture)
    expect(seul.contenu?.transactions[0]).toMatchObject({ htCentimes: -4000, tvaCentimes: -800 })
    expect(seul.etat).toBe('a_declarer')
  })

  it('rangent par la prestation, ou la fin de la période facturée, ou la facture', () => {
    // [DG] note 125 ; [CO] point 6.
    const prestee = facture({ date_emission: '2027-09-28', date_prestation: '2027-10-03' })
    expect(dateQuiRangeLaVente(prestee, 'date_de_realisation')).toBe('2027-10-03')
    expect(dateQuiRangeLaVente(prestee, 'date_de_la_facture')).toBe('2027-09-28')
    expect(dateQuiRangeLaVente(facture({ date_emission: '2027-09-28', periode_fin: '2027-10-31' }), 'date_de_realisation')).toBe('2027-10-31')
    expect(dateQuiRangeLaVente(facture({ date_emission: '2027-09-28' }), 'date_de_realisation')).toBe('2027-09-28')
    const s = ventes({ factures: lu([prestee]) })
    expect(declarationDesVentes(contexte(), s, parRealisation).contenu?.transactions[0].date).toBe('2027-10-03')
    expect(declarationDesVentes(contexte(), s, parFacture).etat).toBe('rien_a_declarer')
  })

  it('rangent une facture du premier et du dernier jour, pas de la veille ni du lendemain', () => {
    const le = (date: string) => declarationDesVentes(contexte(), ventes({ factures: lu([facture({ date_emission: date })]) }), parFacture).etat
    expect(le('2027-10-01')).toBe('a_declarer')
    expect(le('2027-10-31')).toBe('a_declarer')
    expect(le('2027-09-30')).toBe('rien_a_declarer')
    expect(le('2027-11-01')).toBe('rien_a_declarer')
  })

  it('écartent une facture antérieure au 1er septembre 2027, même prestée après', () => {
    const s = ventes({ factures: lu([facture({ date_emission: '2027-08-31', date_prestation: '2027-10-02' })]) })
    const d = declarationDesVentes(contexte(), s, parRealisation)
    expect(d.ecartees).toEqual([{ source: { genre: 'facture', id: 'v1' }, raison: 'avant_l_obligation' }])
    expect(d.etat).toBe('rien_a_declarer')
  })

  it('laissent la facture électronique aux entreprises établies en France, et les brouillons', () => {
    // [T] § 70 et [DG] § 3.7.3 : l'e-reporting couvre ce que la facture électronique ne porte pas.
    for (const o of [{ type_client: 'assujetti' as const }, { type_client: 'organisme_public' as const }, { statut: 'brouillon' as const }]) {
      const d = declarationDesVentes(contexte(), ventes({ factures: lu([facture(o)]) }), parFacture)
      expect(d.etat).toBe('rien_a_declarer')
      expect(d.ecartees).toEqual([])
    }
  })
})

describe('les ventes : ce que le statut de TVA fait entrer', () => {
  const zero = ventes({ factures: lu([facture({ montant_tva: 0, montant_ttc: 100 })]), lignes: lu([ligne({ taux_tva: 0 })]) })

  it('un franchisé déclare ses ventes au taux 0, et se fait refuser une ligne taxée', () => {
    // [CO] point 7 : TPS1 au taux 0 ; [M] § 70 : le bimestre civil.
    const franchise = contexte({ periode: SEPTEMBRE_OCTOBRE, dossier: dossier({ statut_tva: 'franchise' }) })
    const d = declarationDesVentes(franchise, zero, parFacture)
    expect(d.contenu?.transactions).toEqual([{
      date: '2027-10-08', devise: 'EUR', categorie: 'TPS1', optionDebits: false, htCentimes: 10000, tvaCentimes: 0,
      parTaux: [{ taux: 0, baseCentimes: 10000, tvaCentimes: 0 }], factures: ['v1'],
    }])
    expect(d.periode?.echeance).toBe('2027-11-25')
    const taxee = declarationDesVentes(franchise, ventes(), parFacture)
    expect(taxee.refus).toEqual([{
      cle: 'taux_positif', sources: [{ genre: 'facture', id: 'v1' }],
      message: 'Une facture d’un dossier en franchise en base porte une ligne à 20 % : un dossier qui ne facture pas de TVA '
        + 'la doit dès qu’il la mentionne. La facture se corrige par un avoir, ou le statut de TVA du dossier est à revoir.',
    }])
    expect(taxee.etat).toBe('incomplete')
  })

  it('un dossier exonéré n’y déclare pas ses soins — sans dire qu’il n’y est pas tenu', () => {
    // [C] § 20 : les opérations exonérées en sortent ; [E1] : « le cas échéant ».
    const exonere = contexte({ dossier: dossier({ statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1' }) })
    const d = declarationDesVentes(exonere, zero, parFacture)
    expect(d.obligation).toBe('le_cas_echeant')
    expect(d.etat).toBe('rien_a_declarer')
    expect(d.ecartees).toEqual([{ source: { genre: 'facture', id: 'v1' }, raison: 'operation_exoneree' }])
    expect(d.refus.map((r) => r.message)).toEqual(['Aucune opération sur la période : aucune transmission n’est attendue.'])
    // Exonérée de toute façon : ni le client inconnu ni la nature ne la retiennent.
    const inconnue = ventes({ factures: lu([facture({ montant_tva: 0, montant_ttc: 100, type_client: null, nature_operation: null })]), lignes: zero.lignes })
    expect(declarationDesVentes(exonere, inconnue, parFacture).ecartees).toEqual([{ source: { genre: 'facture', id: 'v1' }, raison: 'operation_exoneree' }])
    const taxee = declarationDesVentes(exonere, ventes({ lignes: lu([ligne({ taux_tva: 5.5 })]), factures: lu([facture({ montant_tva: 5.5, montant_ttc: 105.5 })]) }), parFacture)
    expect(taxee.refus[0].message).toBe('Une facture d’un dossier exonéré porte une ligne à 5,5 % : un dossier qui ne facture '
      + 'pas de TVA la doit dès qu’il la mentionne. La facture se corrige par un avoir, ou le statut de TVA du dossier est à revoir.')
  })

  it('un redevable qui a l’article de son exonération : sa facture toute à 0 % sort', () => {
    const d = declarationDesVentes(contexte({ dossier: dossier({ article_exoneration: 'cgi_261_4_4_a' }) }), zero, parFacture)
    expect(d.ecartees).toEqual([{ source: { genre: 'facture', id: 'v1' }, raison: 'operation_exoneree' }])
    expect(d.etat).toBe('rien_a_declarer')
  })
})

describe('les ventes : ce qu’une facture laisse sans réponse', () => {
  const avec = (o: Partial<FactureLue>) => declarationDesVentes(contexte(), ventes({ factures: lu([facture(o)]) }), parFacture)

  it('son client, ses mentions internationales, sa nature, son option, ses montants — un refus chacun', () => {
    // [CO] § 4.3 : la facture à un particulier mêlant biens et services ; la facture internationale sans ses mentions.
    const attendus: [Partial<FactureLue>, string, string][] = [
      [{ type_client: null }, 'destinataire_inconnu', 'Une facture ne dit pas à qui elle est adressée — une entreprise, un '
        + 'particulier, un client établi hors de France : l’e-reporting en dépend, et validée, elle ne se complète plus.'],
      [{ type_client: 'etranger' }, 'facture_internationale', 'Une facture à un client établi hors de France ne porte ni son '
        + 'pays, ni son numéro de TVA, ni le régime de l’opération, que l’e-reporting demande : l’application ne les saisit pas encore.'],
      [{ nature_operation: null }, 'nature_inconnue', 'Une facture à un particulier ne dit pas si elle porte sur des biens ou '
        + 'des services : la catégorie de l’opération en dépend, et validée, elle ne se complète plus.'],
      [{ nature_operation: 'mixte' }, 'facture_mixte', 'Une facture à un particulier mêle biens et services : l’e-reporting les '
        + 'déclare à part, et ses lignes ne disent pas lesquelles sont des biens.'],
      [{ option_debits: null }, 'option_inconnue', 'Une facture de services ne dit pas si le dossier avait opté pour la TVA sur '
        + 'les débits : ce qui s’en déclare en dépend, et validée, elle ne se complète plus.'],
      [{ montant_ht: 101 }, 'montants_incoherents', 'Les montants enregistrés d’une facture ne se retrouvent pas dans ses '
        + 'lignes : ce qu’elle déclare ne se dit pas.'],
    ]
    for (const [o, cle, message] of attendus) {
      const d = avec(o)
      expect(d.refus, cle).toEqual([{ cle, message, sources: [{ genre: 'facture', id: 'v1' }] }])
      expect(d.etat, cle).toBe('incomplete')
      expect(d.contenu?.transactions, cle).toEqual([])
    }
    // L'option ne regarde pas des biens ; la TVA et le TTC de l'en-tête se comparent aussi.
    expect(avec({ nature_operation: 'biens', option_debits: null }).refus).toEqual([])
    expect(cles(avec({ montant_tva: 21 }))).toEqual(['montants_incoherents'])
    expect(cles(avec({ montant_ttc: 121 }))).toEqual(['montants_incoherents'])
  })

  it('un seul refus par facture : le premier de l’ordre', () => {
    expect(cles(avec({ type_client: null, nature_operation: 'mixte', montant_ht: 1 }))).toEqual(['destinataire_inconnu'])
    expect(cles(avec({ type_client: 'etranger', nature_operation: null }))).toEqual(['facture_internationale'])
    expect(cles(avec({ nature_operation: 'mixte', option_debits: null }))).toEqual(['facture_mixte'])
    expect(cles(avec({ option_debits: null, montant_ht: 1 }))).toEqual(['option_inconnue'])
  })

  it('dit une facture dont les lignes manquent à la lecture', () => {
    const d = declarationDesVentes(contexte(), ventes({ lignes: lu([ligne({ facture_id: 'autre' })]) }), parFacture)
    expect(d.refus).toEqual([{
      cle: 'lectures_discordantes', sources: [{ genre: 'facture', id: 'v1' }],
      message: 'Ce qui a été lu ne concorde pas — une facture sans ses lignes : relisez.',
    }])
  })

  it('ignore une facture d’un autre dossier', () => {
    expect(declarationDesVentes(contexte(), ventes({ factures: lu([facture({ dossier_id: 'd2' })]) }), parFacture).etat)
      .toBe('rien_a_declarer')
  })
})

// ── Les paiements ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('les paiements : le registre des encaissements, net', () => {
  it('agrègent les encaissements d’un jour par taux', () => {
    // [P] § 150 : « globalisées par jour et par taux » ; [A6] TT-96, TT-97, TT-99 ; [A7] G6.27 : en euros.
    const d = declarationDesPaiements(contexte(), paiements(), parDecaissement)
    expect(d.etat).toBe('a_declarer')
    expect(d.contenu).toEqual({
      role: 'SE', siren: SIREN, nombreOperations: 1, montantCentimes: 12000,
      paiements: [{ date: '2027-10-15', montantCentimes: 12000, parTaux: [{ taux: 20, montantCentimes: 12000 }], encaissements: ['e1'] }],
    })
  })

  it('réunissent deux encaissements d’un jour, séparent deux jours, les taux du plus fort au plus faible', () => {
    const s = paiements({
      factures: lu([facture(), facture({ id: 'v2', montant_ht: 200, montant_tva: 30, montant_ttc: 230 })]),
      // Lus dans le désordre : le jour les range par identifiant.
      encaissements: lu([encaissement({ id: 'e3', date_encaissement: '2027-10-16', montant: 60 }), encaissement({ id: 'e2', facture_id: 'v2', montant: 115 }), encaissement()]),
      parts: lu([part(), part({ encaissement_id: 'e2', taux: 10, montant: 55 }), part({ encaissement_id: 'e2', taux: 20, montant: 60 }),
        part({ encaissement_id: 'e3', montant: 60 })]),
    })
    const d = declarationDesPaiements(contexte(), s, parDecaissement)
    expect(d.contenu?.paiements).toEqual([
      { date: '2027-10-15', montantCentimes: 23500, parTaux: [{ taux: 20, montantCentimes: 18000 }, { taux: 10, montantCentimes: 5500 }], encaissements: ['e1', 'e2'] },
      { date: '2027-10-16', montantCentimes: 6000, parTaux: [{ taux: 20, montantCentimes: 6000 }], encaissements: ['e3'] },
    ])
    expect(d.contenu?.montantCentimes).toBe(29500)
    expect(d.contenu?.nombreOperations).toBe(3)
  })

  it('mettent le plus fort taux d’abord, même entré le second', () => {
    const s = paiements({
      factures: lu([facture({ id: 'v1', montant_ht: 50, montant_tva: 5, montant_ttc: 55 }), facture({ id: 'v2' })]),
      encaissements: lu([encaissement({ id: 'e1', montant: 55 }), encaissement({ id: 'e2', facture_id: 'v2', montant: 60 })]),
      parts: lu([part({ encaissement_id: 'e1', taux: 10, montant: 55 }), part({ encaissement_id: 'e2', taux: 20, montant: 60 })]),
    })
    expect(declarationDesPaiements(contexte(), s, parDecaissement).contenu?.paiements[0].parTaux)
      .toEqual([{ taux: 20, montantCentimes: 6000 }, { taux: 10, montantCentimes: 5500 }])
  })

  it('comptent au centime un montant que la virgule flottante écrit juste en dessous', () => {
    // 4,35 × 100 vaut 434,99999999999994 en virgule flottante ([D1], d2 : la troncature est la faute à éviter).
    const s = paiements({ encaissements: lu([encaissement({ montant: 4.35 })]), parts: lu([part({ montant: 4.35 })]) })
    expect(declarationDesPaiements(contexte(), s, parDecaissement).contenu?.montantCentimes).toBe(435)
  })

  it('ne comptent pas un encaissement retiré', () => {
    // [D1] : jamais déclaré, un encaissement se retire et ne compte plus.
    const d = declarationDesPaiements(contexte(), paiements({ encaissements: lu([encaissement({ retire_le: '2027-10-20T09:00:00Z' })]) }), parDecaissement)
    expect(d.etat).toBe('rien_a_declarer')
    expect(d.refus).toEqual([{
      cle: 'rien_a_declarer', sources: [],
      message: 'Aucun paiement sur la période : rien à transmettre — à confirmer, les textes ne le disant que des transactions.',
    }])
  })

  it('comptent une contre-passation en moins, à sa date ou à celle de l’encaissement qu’elle annule', () => {
    // [D1] : une contre-passation, de montant opposé ; [CO] § 4.6 et point 9.
    const cp = encaissement({ id: 'c1', annule_id: 'e1', montant: -120, date_encaissement: '2027-11-03' })
    const s = paiements({ encaissements: lu([cp, encaissement()]), parts: lu([part(), part({ encaissement_id: 'c1', montant: -120 })]) })
    const novembre = contexte({ periode: NOVEMBRE, aujourdHui: '2027-12-02' })
    expect(declarationDesPaiements(contexte(), s, parDecaissement).contenu?.paiements).toEqual([
      { date: '2027-10-15', montantCentimes: 12000, parTaux: [{ taux: 20, montantCentimes: 12000 }], encaissements: ['e1'] },
    ])
    const enNovembre = declarationDesPaiements(novembre, s, parDecaissement)
    expect(enNovembre.contenu?.paiements).toEqual([
      { date: '2027-11-03', montantCentimes: -12000, parTaux: [{ taux: 20, montantCentimes: -12000 }], encaissements: ['c1'] },
    ])
    expect(enNovembre.etat).toBe('a_declarer')
    // Rangée avec l'encaissement qu'elle annule : octobre se rectifie, et le jour revient à zéro.
    expect(declarationDesPaiements(contexte(), s, parEncaissementAnnule).contenu?.paiements).toEqual([
      { date: '2027-10-15', montantCentimes: 0, parTaux: [{ taux: 20, montantCentimes: 0 }], encaissements: ['c1', 'e1'] },
    ])
    expect(declarationDesPaiements(novembre, s, parEncaissementAnnule).etat).toBe('rien_a_declarer')
    // Retirée, elle ne compte plus.
    const retiree = paiements({ encaissements: lu([{ ...cp, retire_le: '2027-11-04T08:00:00Z' }, encaissement()]), parts: s.parts })
    expect(declarationDesPaiements(novembre, retiree, parDecaissement).etat).toBe('rien_a_declarer')
  })

  it('dit une contre-passation dont l’encaissement annulé manque à la lecture, dans sa période seulement', () => {
    const orpheline = paiements({
      encaissements: lu([encaissement({ id: 'c1', annule_id: 'e0', montant: -120, date_encaissement: '2027-11-03' })]),
      parts: lu([part({ encaissement_id: 'c1', montant: -120 })]),
    })
    const novembre = contexte({ periode: NOVEMBRE, aujourdHui: '2027-12-02' })
    for (const choix of [parDecaissement, parEncaissementAnnule]) {
      expect(declarationDesPaiements(novembre, orpheline, choix).refus).toEqual([{
        cle: 'lectures_discordantes', sources: [{ genre: 'encaissement', id: 'c1' }],
        message: 'Ce qui a été lu ne concorde pas — une contre-passation sans l’encaissement qu’elle annule : relisez.',
      }])
      expect(declarationDesPaiements(contexte(), orpheline, choix).etat).toBe('rien_a_declarer')
    }
  })

  it('rangent un encaissement du premier et du dernier jour, pas de la veille ni du lendemain', () => {
    const le = (date: string) => declarationDesPaiements(contexte(), paiements({ encaissements: lu([encaissement({ date_encaissement: date })]) }), parDecaissement).etat
    expect(le('2027-10-01')).toBe('a_declarer')
    expect(le('2027-10-31')).toBe('a_declarer')
    expect(le('2027-09-30')).toBe('rien_a_declarer')
    expect(le('2027-11-01')).toBe('rien_a_declarer')
  })
})

describe('les paiements : ce qui se déclare', () => {
  const avecFacture = (o: Partial<FactureLue>, d = dossier()) =>
    declarationDesPaiements(contexte({ dossier: d }), paiements({ factures: lu([facture(o)]) }), parDecaissement)

  it('la facture décide de l’obligation, l’encaissement de la période', () => {
    // [P] § 1 ; [E1] `dansLObligation`.
    const d = avecFacture({ date_emission: '2027-08-31' })
    expect(d.ecartees).toEqual([{ source: { genre: 'encaissement', id: 'e1' }, raison: 'avant_l_obligation' }])
    expect(d.etat).toBe('rien_a_declarer')
  })

  it('écartent une livraison de biens et l’option pour les débits, sûrement, avant toute inconnue', () => {
    // [DG] note 119 : des prestations de services, hors option pour les débits ; [P] § 30.
    expect(avecFacture({ nature_operation: 'biens', type_client: null }).ecartees)
      .toEqual([{ source: { genre: 'encaissement', id: 'e1' }, raison: 'livraison_de_biens' }])
    expect(avecFacture({ option_debits: true, nature_operation: null }).ecartees)
      .toEqual([{ source: { genre: 'encaissement', id: 'e1' }, raison: 'option_debits' }])
  })

  it('laissent au statut « Encaissée » les factures à une entreprise établie en France', () => {
    for (const type_client of ['assujetti', 'organisme_public'] as const) {
      const d = avecFacture({ type_client })
      expect(d.etat).toBe('rien_a_declarer')
      expect(d.ecartees).toEqual([])
    }
  })

  it('refusent ce que la facture laisse sans réponse, sous les mêmes mots que les ventes', () => {
    const attendus: [Partial<FactureLue>, string][] = [
      [{ type_client: null }, 'destinataire_inconnu'], [{ type_client: 'etranger' }, 'facture_internationale'],
      [{ nature_operation: null }, 'nature_inconnue'], [{ nature_operation: 'mixte' }, 'facture_mixte'],
      [{ option_debits: null }, 'option_inconnue'],
    ]
    for (const [o, cle] of attendus) {
      const d = avecFacture(o)
      expect(cles(d), cle).toEqual([cle])
      expect(d.refus[0].sources, cle).toEqual([{ genre: 'encaissement', id: 'e1' }, { genre: 'facture', id: 'v1' }])
      expect(d.refus[0].message, cle).toBe(REFUS_EREPORTING.find((r) => r.cle === cle)?.modele)
    }
  })

  it('suivent le statut de TVA, part par part', () => {
    // Franchise : au taux 0 ([CO] § 1.3 : « OUI (10.4, au taux 0 en franchise) »).
    const franchise = contexte({ periode: SEPTEMBRE_OCTOBRE, dossier: dossier({ statut_tva: 'franchise' }) })
    expect(declarationDesPaiements(franchise, paiements({ parts: lu([part({ taux: 0 })]) }), parDecaissement).contenu?.paiements[0].parTaux)
      .toEqual([{ taux: 0, montantCentimes: 12000 }])
    expect(cles(declarationDesPaiements(franchise, paiements(), parDecaissement))).toEqual(['taux_positif'])
    // Exonéré : ses opérations exonérées sortent ([C] § 20).
    const exonere = contexte({ dossier: dossier({ statut_tva: 'exonere' }) })
    expect(declarationDesPaiements(exonere, paiements({ parts: lu([part({ taux: 0 })]) }), parDecaissement).ecartees)
      .toEqual([{ source: { genre: 'encaissement', id: 'e1' }, raison: 'operation_exoneree' }])
    expect(cles(declarationDesPaiements(exonere, paiements(), parDecaissement))).toEqual(['taux_positif'])
    // Redevable : la part à 0 % sort avec l'article, se refuse sans lui.
    const mixte = paiements({ parts: lu([part({ montant: 100 }), part({ taux: 0, montant: 20 })]) })
    const avecArticle = declarationDesPaiements(contexte({ dossier: dossier({ article_exoneration: 'cgi_261_4_1' }) }), mixte, parDecaissement)
    expect(avecArticle.contenu?.paiements[0].parTaux).toEqual([{ taux: 20, montantCentimes: 10000 }])
    expect(avecArticle.ecartees).toEqual([{ source: { genre: 'encaissement', id: 'e1' }, raison: 'part_exoneree' }])
    expect(cles(declarationDesPaiements(contexte(), mixte, parDecaissement))).toEqual(['zero_sans_article'])
  })

  it('disent une facture ou une répartition qui manquent à la lecture', () => {
    const sansFacture = declarationDesPaiements(contexte(), paiements({ factures: lu([]) }), parDecaissement)
    expect(sansFacture.refus).toEqual([{
      cle: 'lectures_discordantes', sources: [{ genre: 'encaissement', id: 'e1' }],
      message: 'Ce qui a été lu ne concorde pas — un encaissement sans sa facture : relisez.',
    }])
    const message = 'Ce qui a été lu ne concorde pas — un encaissement sans sa répartition par taux entière : relisez.'
    expect(declarationDesPaiements(contexte(), paiements({ parts: lu([]) }), parDecaissement).refus[0].message).toBe(message)
    expect(declarationDesPaiements(contexte(), paiements({ parts: lu([part({ montant: 100 })]) }), parDecaissement).refus[0].message).toBe(message)
    // Une facture d'un autre dossier n'est pas la sienne.
    expect(cles(declarationDesPaiements(contexte(), paiements({ factures: lu([facture({ dossier_id: 'd2' })]) }), parDecaissement)))
      .toEqual(['lectures_discordantes'])
  })

  it('ignorent les encaissements et les parts d’un autre dossier', () => {
    const s = paiements({
      encaissements: lu([encaissement(), encaissement({ id: 'eX', dossier_id: 'd2' })]),
      parts: lu([part(), part({ encaissement_id: 'e1', dossier_id: 'd2', montant: 5 })]),
    })
    const d = declarationDesPaiements(contexte(), s, parDecaissement)
    expect(d.refus).toEqual([])
    expect(d.contenu?.paiements).toEqual([
      { date: '2027-10-15', montantCentimes: 12000, parTaux: [{ taux: 20, montantCentimes: 12000 }], encaissements: ['e1'] },
    ])
  })
})

// ── L'ordre des refus, et la stabilité ──────────────────────────────────────────────────────────────────────────────

describe('les refus se disent dans l’ordre fixé, opération par opération dans l’ordre des dates', () => {
  it('pour les ventes d’un dossier dont tout manque', () => {
    const s = ventes({
      factures: lu([
        facture({ id: 'v9', date_emission: '2027-10-20', montant_ht: 1 }),
        facture({ id: 'v8', date_emission: '2027-10-19', option_debits: null }),
        facture({ id: 'v7', date_emission: '2027-10-18', nature_operation: 'mixte' }),
        facture({ id: 'v6', date_emission: '2027-10-17', nature_operation: null }),
        facture({ id: 'v5', date_emission: '2027-10-16', type_client: 'etranger' }),
        facture({ id: 'v4', date_emission: '2027-10-15', type_client: null }),
        facture({ id: 'v3', date_emission: '2027-10-14', montant_tva: 0, montant_ttc: 100 }),
        facture({ id: 'v2', date_emission: '2027-10-13', type_client: null }),
        facture({ id: 'v1', date_emission: '2027-10-12' }),
      ]),
      lignes: lu(['v1', 'v2', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9'].map((id) => ligne({ facture_id: id })).concat(ligne({ facture_id: 'v3', taux_tva: 0 }))),
    })
    const d = declarationDesVentes(contexte({ aujourdHui: '2027-10-31', regimeConfirme: false, dossier: dossier({ siret: null }) }), s, parFacture)
    expect(cles(d)).toEqual([
      'periode_en_cours', 'regime_a_confirmer', 'siren_invalide', 'destinataire_inconnu', 'destinataire_inconnu',
      'facture_internationale', 'nature_inconnue', 'facture_mixte', 'option_inconnue', 'montants_incoherents', 'zero_sans_article',
    ])
    expect(d.refus.filter((r) => r.cle === 'destinataire_inconnu').map((r) => r.sources[0].id)).toEqual(['v2', 'v4'])
    expect(d.contenu?.nombreOperations).toBe(1)
    expect(d.etat).toBe('incomplete')
  })

  it('pour les achats : la fiche à revoir avant la pièce qui attend, avant celle mise de côté', () => {
    const s = achats({
      pieces: lu([
        piece({ id: 'p3', devise: 'USD', montant_devise: 10, montant_tva: 2, date_piece: '2027-10-02' }),
        piece({ id: 'p2', devise: 'USD', montant_devise: 10, date_piece: '2027-10-03' }),
        piece({ montant_ttc: 99 }),
      ]),
    })
    const d = declarationDesAchats(contexte(), s, parFacture)
    expect(cles(d)).toEqual(['fiche_a_revoir', 'achat_a_verifier', 'achat_avec_tva'])
  })

  it('rendent le même contenu quel que soit l’ordre des lectures', () => {
    const lignes = [ligne({ facture_id: 'v1' }), ligne({ facture_id: 'v2', taux_tva: 10, prix_unitaire_ht: 50 }), ligne({ facture_id: 'v3' })]
    const factures = [facture({ id: 'v1' }), facture({ id: 'v2', montant_ht: 50, montant_tva: 5, montant_ttc: 55 }), facture({ id: 'v3', date_emission: '2027-10-02' })]
    const a = declarationDesVentes(contexte(), ventes({ factures: lu(factures), lignes: lu(lignes) }), parFacture)
    const b = declarationDesVentes(contexte(), ventes({ factures: lu([...factures].reverse()), lignes: lu([...lignes].reverse()) }), parFacture)
    expect(b).toEqual(a)
    expect(a.contenu?.transactions.map((t) => t.date)).toEqual(['2027-10-02', '2027-10-08'])
    expect(a.contenu?.transactions[1].parTaux.map((t) => t.taux)).toEqual([20, 10])
    expect(a.contenu?.transactions[1].factures).toEqual(['v1', 'v2'])
  })
})

// ── Une période qui chevauche un changement de statut ───────────────────────────────────────────────────────────────

describe('une période qui chevauche un changement de statut de TVA', () => {
  // Un dossier sorti de la franchise à la mi-octobre 2027, redevable depuis : la base ne garde que son statut d'AUJOURD'HUI.
  const franchiseDeSeptembre = facture({ id: 'v1', date_emission: '2027-10-04', montant_tva: 0, montant_ttc: 100 })
  const taxeeDeFinOctobre = facture({ id: 'v2', date_emission: '2027-10-25' })
  const s = ventes({
    factures: lu([franchiseDeSeptembre, taxeeDeFinOctobre]),
    lignes: lu([ligne({ facture_id: 'v1', taux_tva: 0 }), ligne({ facture_id: 'v2' })]),
  })

  it('le bimestre de la franchise n’est pas une période du régime d’aujourd’hui', () => {
    const aujourdhui = contexte({ periode: SEPTEMBRE_OCTOBRE })
    for (const d of [declarationDesVentes(aujourdhui, s, parFacture), declarationDesAchats(aujourdhui, achats(), parFacture),
      declarationDesPaiements(aujourdhui, paiements(), parDecaissement)]) {
      expect(cles(d)).toEqual(['periode_hors_regime'])
      expect(d.contenu).toBeNull()
    }
  })

  it('sous le régime passé, la facture taxée contredit la franchise ; sous celui d’aujourd’hui, la facture sans TVA', () => {
    const commeAvant = declarationDesVentes(contexte({ periode: SEPTEMBRE_OCTOBRE, dossier: dossier({ statut_tva: 'franchise' }) }), s, parFacture)
    expect(cles(commeAvant)).toEqual(['taux_positif'])
    expect(commeAvant.refus[0].sources).toEqual([{ genre: 'facture', id: 'v2' }])
    expect(commeAvant.contenu?.transactions.map((t) => t.factures)).toEqual([['v1']])
    const commeAujourdhui = declarationDesVentes(contexte(), s, parFacture)
    expect(cles(commeAujourdhui)).toEqual(['zero_sans_article'])
    expect(commeAujourdhui.refus[0].sources).toEqual([{ genre: 'facture', id: 'v1' }])
    // Jamais déclarée sous un régime qu'elle n'avait pas : les deux périodes sont incomplètes.
    expect(commeAvant.etat).toBe('incomplete')
    expect(commeAujourdhui.etat).toBe('incomplete')
  })
})

// ── Le fuseau de qui regarde n'y change rien ────────────────────────────────────────────────────────────────────────

describe('sur le calendrier civil, sous les quatre fuseaux de test:fuseaux', () => {
  const FUSEAU_D_ORIGINE = process.env.TZ
  afterEach(() => {
    process.env.TZ = FUSEAU_D_ORIGINE
  })

  it('rend les mêmes déclarations à Paris, en UTC, à New York et à Auckland', () => {
    const jouer = () => [
      declarationDesAchats(contexte({ aujourdHui: '2027-10-31' }), achats({ fiches: lu([fiche({ date_facture: '2027-10-31' })]) }), parFacture),
      declarationDesVentes(contexte(), ventes({ factures: lu([facture({ date_emission: '2027-10-01' })]) }), parFacture),
      declarationDesPaiements(contexte({ aujourdHui: '2027-11-01' }), paiements({ encaissements: lu([encaissement({ date_encaissement: '2027-10-31' })]) }), parDecaissement),
    ]
    // Le test choisit ses fuseaux : sous Europe/Paris seul, un calcul par `new Date` passerait.
    process.env.TZ = 'Pacific/Auckland'
    const reference = jouer()
    expect(reference.map((d) => d.etat)).toEqual(['a_declarer', 'a_declarer', 'a_declarer'])
    expect(cles(reference[0])).toEqual(['periode_en_cours'])
    for (const fuseau of ['Europe/Paris', 'UTC', 'America/New_York']) {
      process.env.TZ = fuseau
      expect(jouer(), fuseau).toEqual(reference)
    }
  })
})
