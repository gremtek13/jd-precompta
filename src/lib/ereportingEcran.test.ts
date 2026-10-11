import { describe, expect, it } from 'vitest'
import {
  AUJOURDHUI, D1, D2, E1, F1, F2, OCTOBRE, P1, P2, R1, R2, V1, V2, dossier, ecart, encaissement, facture, fiche, lu, luEnPartie, part, piece,
  regime, sources, declaree,
} from '../test/ereportingEcran'
import {
  LECTURES_DE_LA_FENETRE, confirmationDeLEcart, confirmationDeLaDeclaration, confirmationDeLaReprise, confirmationDuRegime,
  confirmationDuRetraitDuRegime, contexteDeLaDeclaration, declarationCalculee, ecarteesEnMots, etatDuRegime, ligneAFaire,
  csvDuDetail, ligneDePeriode, lignesDeLEreporting, lecturesManquantes, montantEnDevise, motsDeLaCause, motsDeLaDifference, nomDeLaPiece,
  nomFichierDuDetail, nomDeLaSource, obligationsDeLaCarte, offreDeDeclaration, periodeDesBornes, periodesDeLObjet, phraseDeCeQueLaDeclarationGarde,
  phraseDesFrequences, phraseDuContenu, pieceDeclaree, resumeDeLaLigne, saisieDeLaDeclaration, sourcesDuRefus, tableauDuContenu,
} from './ereportingEcran'
import { refusDeclaration } from './declarationsEreporting'
import { periodeDe } from './periodesEreporting'
import type { DeclarationEreportingHorsApplication } from './types'

// CE QUE LA FENÊTRE DE L'E-REPORTING DIT, SANS L'ÉCRAN (ligne 28.5, étape e5c). Le monde des tests est fictif
// (src/test/ereportingEcran.ts) : « aujourd'hui » est le 5 novembre 2027, octobre est échu, novembre est en cours. Chaque
// attendu est écrit à la main depuis ce que dit la règle d'en dessous — les périodes d'e1, les états d'e4 et d'e5b1 —, non
// recopié du module.

const MOIS_SANS_ESPACES = (t: string) => t.replace(/[  ]/g, ' ')

describe('les lectures manquantes', () => {
  it('toutes revenues entières : rien ne manque', () => {
    expect(lecturesManquantes(sources())).toEqual([])
  })

  it('chaque lecture partielle se nomme, avec son motif et l’accord de son participe, dans l’ordre de la fenêtre', () => {
    for (const { cle, quoi, accord } of LECTURES_DE_LA_FENETRE) {
      const s = { ...sources(), [cle]: luEnPartie([], `motif de ${cle}`) }
      expect(lecturesManquantes(s), cle).toEqual([{ quoi, accord, motif: `motif de ${cle}` }])
    }
    // Les douze sources de la fenêtre, une fois chacune.
    expect(LECTURES_DE_LA_FENETRE.map((l) => l.cle).sort()).toEqual(Object.keys(sources()).sort())
  })

  it('plusieurs lectures partielles se disent toutes, une lecture sans motif en dit un', () => {
    const s = sources({ factures: luEnPartie([], 'a'), ecarts: { lignes: [], complete: false, motif: null } })
    expect(lecturesManquantes(s).map((m) => [m.quoi, m.motif])).toEqual([
      ['Les pièces écartées de l’e-reporting', 'lecture incomplète'],
      ['Les factures émises', 'a'],
    ])
  })
})

describe('les périodes d’un objet', () => {
  const periodes = (objet: 'ventes' | 'achats' | 'paiements', s = sources(), d = dossier(), jour = AUJOURDHUI) =>
    periodesDeLObjet(objet, s, d, jour).map((p) => `${p.debut}..${p.fin}`)

  it('aucune avant les opérations du 1er septembre 2027', () => {
    expect(periodes('achats', sources(), dossier(), '2027-08-31')).toEqual([])
    expect(periodes('achats', sources(), dossier(), '2026-10-12')).toEqual([])
  })

  it('un régime confirmé au rythme du mois : septembre, octobre, novembre, de la plus récente à la plus ancienne', () => {
    for (const objet of ['ventes', 'achats', 'paiements'] as const) {
      expect(periodes(objet), objet).toEqual(['2027-11-01..2027-11-30', '2027-10-01..2027-10-31', '2027-09-01..2027-09-30'])
    }
  })

  it('sans régime confirmé, les périodes du statut d’aujourd’hui, proposé : un franchisé au bimestre', () => {
    const s = sources({ regimes: lu([]) })
    // Les bimestres civils commencent un mois impair : septembre-octobre, puis novembre-décembre, en cours le 5 novembre.
    expect(periodes('achats', s, dossier({ statut_tva: 'franchise' }))).toEqual(['2027-11-01..2027-12-31', '2027-09-01..2027-10-31'])
    expect(periodes('achats', s, dossier({ statut_tva: 'franchise' }), '2027-10-15')).toEqual(['2027-09-01..2027-10-31'])
  })

  it('sans régime confirmé et sans statut : aucune période', () => {
    expect(periodes('achats', sources({ regimes: lu([]) }), dossier({ statut_tva: null, article_exoneration: null }))).toEqual([])
  })

  it('un redevable mensuel sans régime confirmé : par décade (une fois la décade commencée)', () => {
    const s = sources({ regimes: lu([]) })
    expect(periodes('ventes', s, dossier({ tva_periodicite: 'mensuelle' }), '2027-09-15'))
      .toEqual(['2027-09-11..2027-09-20', '2027-09-01..2027-09-10'])
  })

  it('les paiements sur option pour les débits n’ont aucune période', () => {
    const s = sources({ regimes: lu([regime({ frequence_paiements: null, tva_sur_debits: true })]) })
    expect(periodes('paiements', s)).toEqual([])
    expect(periodes('ventes', s)).toHaveLength(3)
    // Et sans régime, la proposition du statut le dit de même.
    expect(periodes('paiements', sources({ regimes: lu([]) }), dossier({ tva_sur_debits: true }))).toEqual([])
  })

  it('un régime qui change de fréquence : chaque période n’est comptée que dans le régime de son premier jour', () => {
    // Au mois jusqu’à fin octobre, par décade depuis le 1er novembre.
    const s = sources({
      regimes: lu([
        regime({ id: R1, depuis: '2026-01-01' }),
        regime({ id: R2, depuis: '2027-11-01', frequence_transactions: 'decade', tva_periodicite: 'mensuelle' }),
      ]),
    })
    expect(periodes('achats', s, dossier(), '2027-11-15')).toEqual([
      '2027-11-11..2027-11-20', '2027-11-01..2027-11-10', '2027-10-01..2027-10-31', '2027-09-01..2027-09-30',
    ])
    // Les paiements restent au mois : la décade ne les regarde pas.
    expect(periodes('paiements', s, dossier(), '2027-11-15')).toEqual(['2027-11-01..2027-11-30', '2027-10-01..2027-10-31', '2027-09-01..2027-09-30'])
  })

  it('un régime retiré ne donne plus ses périodes, et l’actif d’avant les reprend', () => {
    const s = sources({
      regimes: lu([regime({ id: R1 }), regime({ id: R2, depuis: '2027-10-01', frequence_transactions: 'bimestre', retire_le: '2027-10-20T10:00:00Z', retire_par: 'u1' })]),
    })
    expect(periodes('achats', s)).toEqual(['2027-11-01..2027-11-30', '2027-10-01..2027-10-31', '2027-09-01..2027-09-30'])
  })

  it('avant le premier régime confirmé, les périodes se proposent sous le statut d’aujourd’hui', () => {
    // Le régime ne commence qu’au 1er octobre, au bimestre : septembre se propose (au mois, pour un redevable trimestriel) ;
    // octobre est dans le bimestre de septembre-octobre, qui a commencé AVANT le régime, et n’est donc d’aucune des deux listes.
    const s = sources({ regimes: lu([regime({ depuis: '2027-10-01', frequence_transactions: 'bimestre' })]) })
    expect(periodes('achats', s)).toEqual(['2027-11-01..2027-12-31', '2027-09-01..2027-09-30'])
  })

  it('une période déjà déclarée reste dans la liste, quelle que soit sa fréquence', () => {
    // Un bimestre déclaré sous un régime qui, depuis, déclare au mois.
    const auBimestre = sources({ regimes: lu([regime({ frequence_transactions: 'bimestre' })]) })
    const { declaration } = declaree('achats', { debut: '2027-09-01', fin: '2027-10-31' }, auBimestre)
    const liste = periodes('achats', sources({ declarations: lu([declaration]) }))
    expect(liste).toContain('2027-09-01..2027-10-31')
    expect(liste).toContain('2027-10-01..2027-10-31')
  })

  it('une déclaration d’un autre dossier ou d’un autre objet n’ajoute rien', () => {
    const auBimestre = sources({ regimes: lu([regime({ frequence_transactions: 'bimestre' })]) })
    const autre = declaree('ventes', OCTOBRE).declaration
    const d = { ...declaree('achats', { debut: '2027-09-01', fin: '2027-10-31' }, auBimestre).declaration, dossier_id: 'd2' }
    expect(periodes('achats', sources({ declarations: lu([autre, d]) }))).toEqual(['2027-11-01..2027-11-30', '2027-10-01..2027-10-31', '2027-09-01..2027-09-30'])
  })

  it('periodeDesBornes retrouve la période par ses bornes exactes, et rien d’autre', () => {
    expect(periodeDesBornes('2027-10-11', '2027-10-20')?.frequence).toBe('decade')
    expect(periodeDesBornes('2027-10-01', '2027-10-31')?.frequence).toBe('mois')
    expect(periodeDesBornes('2027-09-01', '2027-10-31')?.frequence).toBe('bimestre')
    expect(periodeDesBornes('2027-10-01', '2027-10-30')).toBeNull()
    expect(periodeDesBornes('2027-10-02', '2027-10-31')).toBeNull()
    expect(periodeDesBornes('pas une date', '2027-10-31')).toBeNull()
  })
})

describe('l’état d’une ligne : un objet, une période', () => {
  const periodeDuMois = (debut: string) => periodeDe(debut, 'mois') as NonNullable<ReturnType<typeof periodeDe>>
  const ligneDu = (objet: 'ventes' | 'achats' | 'paiements', debut: string, s = sources(), d = dossier(), jour = AUJOURDHUI) =>
    ligneDePeriode(objet, periodeDuMois(debut), s, d, jour)

  it('octobre est échu : à déclarer avant le 10 novembre, pour les trois objets', () => {
    for (const objet of ['ventes', 'achats', 'paiements'] as const) {
      const l = ligneDu(objet, '2027-10-01')
      expect(l.calcul.etat, objet).toBe('a_declarer')
      expect(l.resume, objet).toMatchObject({ code: 'a_declarer', libelle: 'À déclarer avant le 10/11/2027', ton: 'attention' })
      expect(l.active).toBeNull()
      expect(l.etat).toBeNull()
      expect(offreDeDeclaration(l)).toEqual({ genre: 'initiale' })
      expect(ligneAFaire(l)).toBe(true)
    }
  })

  it('l’échéance dépassée : en retard', () => {
    const l = ligneDu('achats', '2027-10-01', sources(), dossier(), '2027-11-12')
    expect(l.resume).toMatchObject({ code: 'en_retard', libelle: 'En retard', ton: 'danger' })
    expect(l.resume.detail).toContain('L’échéance est dépassée.')
    expect(l.resume.detail).toContain('10/11/2027')
    expect(ligneAFaire(l)).toBe(true)
  })

  it('le jour même de l’échéance : encore à déclarer, pas en retard', () => {
    expect(ligneDu('achats', '2027-10-01', sources(), dossier(), '2027-11-10').resume.code).toBe('a_declarer')
    expect(ligneDu('achats', '2027-10-01', sources(), dossier(), '2027-11-11').resume.code).toBe('en_retard')
  })

  it('novembre n’est pas fini : période en cours, rien ne se déclare', () => {
    const l = ligneDu('achats', '2027-11-01')
    expect(l.resume).toMatchObject({ code: 'en_cours', libelle: 'Période en cours', ton: 'neutre' })
    expect(l.resume.detail).toContain('01/12/2027')
    expect(offreDeDeclaration(l)).toEqual({ genre: 'aucune', pourquoi: null })
    expect(ligneAFaire(l)).toBe(false)
  })

  it('septembre n’a ni achat, ni vente, ni paiement : rien à déclarer', () => {
    for (const objet of ['ventes', 'achats', 'paiements'] as const) {
      const l = ligneDu(objet, '2027-09-01')
      expect(l.resume, objet).toMatchObject({ code: 'rien_a_declarer', libelle: 'Rien à déclarer', ton: 'neutre' })
      expect(offreDeDeclaration(l)).toEqual({ genre: 'aucune', pourquoi: null })
      expect(ligneAFaire(l)).toBe(false)
    }
  })

  it('une pièce d’achat qui ressemble à un achat à l’étranger et n’a pas de fiche : à vérifier, rien ne se déclare', () => {
    const s = sources({
      pieces: lu([piece({ id: P2, devise: 'USD', montant_devise: 50, montant_ttc: 46, date_piece: '2027-10-09', tiers: 'Service en ligne' })]),
      fiches: lu([]), taux: lu([]),
    })
    const l = ligneDu('achats', '2027-10-01', s)
    expect(l.calcul.etat).toBe('incomplete')
    expect(l.resume).toMatchObject({ code: 'a_verifier', libelle: 'À vérifier', ton: 'attention' })
    expect(l.resume.detail).toContain('Le document est en USD')
    expect(offreDeDeclaration(l)).toEqual({ genre: 'aucune', pourquoi: null })
    expect(ligneAFaire(l)).toBe(true)
  })

  it('la même pièce écartée par le cabinet : plus rien ne l’attend, rien à déclarer', () => {
    const s = sources({
      pieces: lu([piece({ id: P2, devise: 'USD', montant_devise: 50, montant_ttc: 46, date_piece: '2027-10-09' })]),
      fiches: lu([]), taux: lu([]), ecarts: lu([ecart({ piece_id: P2 })]),
    })
    const l = ligneDu('achats', '2027-10-01', s)
    expect(l.resume.code).toBe('rien_a_declarer')
    expect(ecarteesEnMots(l.calcul, s)).toEqual(['la pièce « Editeur Logiciel » — Écartée par le cabinet après vérification.'])
  })

  it('sans régime confirmé : le régime est à confirmer, et rien ne se déclare', () => {
    const l = ligneDu('achats', '2027-10-01', sources({ regimes: lu([]) }))
    expect(l.calcul.etat).toBe('a_declarer')
    expect(l.resume).toMatchObject({ code: 'regime_a_confirmer', libelle: 'Régime à confirmer', ton: 'attention' })
    expect(offreDeDeclaration(l)).toEqual({ genre: 'aucune', pourquoi: null })
    expect(ligneAFaire(l)).toBe(true)
  })

  it('l’onglet TVA contredit le régime : à reconfirmer, rien ne se déclare', () => {
    // Le régime dit redevable ; l’onglet dit franchise.
    const l = ligneDu('achats', '2027-10-01', sources(), dossier({ statut_tva: 'franchise', article_exoneration: null }))
    expect(l.resume).toMatchObject({ code: 'regime_a_reconfirmer', libelle: 'Régime à reconfirmer', ton: 'attention' })
    expect(offreDeDeclaration(l).genre).toBe('aucune')
  })

  it('un franchisé sans numéro de TVA : à compléter, le refus du dossier se dit', () => {
    const s = sources({ regimes: lu([regime({ statut_tva: 'franchise', tva_periodicite: null, frequence_transactions: 'bimestre', frequence_paiements: 'bimestre' })]) })
    const l = ligneDePeriode('achats', periodeDe('2027-09-01', 'bimestre') as NonNullable<ReturnType<typeof periodeDe>>, s,
      dossier({ statut_tva: 'franchise', article_exoneration: null }), AUJOURDHUI)
    expect(l.calcul.etat).toBe('incomplete')
    expect(l.resume).toMatchObject({ code: 'a_completer', libelle: 'À compléter', ton: 'attention' })
    expect(l.resume.detail).toContain('numéro de TVA')
    expect(offreDeDeclaration(l)).toEqual({ genre: 'aucune', pourquoi: null })
  })

  it('sur option pour les débits : les paiements sont hors du champ', () => {
    const d = dossier({ tva_sur_debits: true })
    const s = sources({ regimes: lu([regime({ tva_sur_debits: true, frequence_paiements: null })]) })
    const l = ligneDePeriode('paiements', periodeDuMois('2027-10-01'), s, d, AUJOURDHUI)
    expect(l.calcul.etat).toBe('hors_du_champ')
    expect(l.resume).toMatchObject({ code: 'hors_du_champ', libelle: 'Hors du champ', ton: 'neutre' })
    expect(l.resume.detail).toContain('option pour les débits')
  })

  describe('une période déclarée', () => {
    const deux = () => {
      const { declaration, sources: lignesSources } = declaree('achats', OCTOBRE)
      return sources({ declarations: lu([declaration]), sources: lu(lignesSources) })
    }

    it('à jour : ce qui a été déclaré est ce que l’application calcule', () => {
      const l = ligneDu('achats', '2027-10-01', deux())
      expect(l.active?.plateforme).toBe('Plateforme fictive')
      expect(l.etat?.etat).toBe('a_jour')
      expect(l.resume).toMatchObject({ code: 'declaree_a_jour', libelle: 'Déclarée le 02/11/2027', ton: 'ok' })
      expect(l.resume.detail).toContain('sur Plateforme fictive, à jour')
      expect(offreDeDeclaration(l)).toEqual({ genre: 'aucune', pourquoi: null })
      expect(ligneAFaire(l)).toBe(false)
    })

    it('la fiche corrigée après la déclaration : à rectifier, et la rectificative s’offre', () => {
      const s = deux()
      // Une nouvelle version de la fiche, avec une autre date de facture : l’achat déclaré a changé.
      const v1 = { ...fiche(), retire_le: null }
      const v2 = fiche({ id: F2, remplace_id: F1, numero: 'INV-1-BIS', cree_le: '2027-11-03T10:00:00Z' })
      const l = ligneDu('achats', '2027-10-01', { ...s, fiches: lu([v1, v2]), taux: lu([{ ...s.taux.lignes[0] }, { ...s.taux.lignes[0], fiche_id: F2 }]) })
      expect(l.etat?.etat).toBe('a_rectifier')
      expect(l.resume).toMatchObject({ code: 'declaree_a_rectifier', libelle: 'À rectifier', ton: 'attention' })
      expect(l.etat?.differences.map((d) => [d.sorte, d.champs])).toEqual([['changee', ['numero']]])
      expect(offreDeDeclaration(l)).toEqual({ genre: 'rectificative' })
      expect(ligneAFaire(l)).toBe(true)
    })

    it('un régime retiré depuis : à rectifier par sa cause, mais la rectificative attend la confirmation d’un régime', () => {
      const s = deux()
      const l = ligneDu('achats', '2027-10-01', { ...s, regimes: lu([regime({ retire_le: '2027-11-03T10:00:00Z', retire_par: 'u1' })]) })
      expect(l.etat?.etat).toBe('a_rectifier')
      expect(l.etat?.causes.map((c) => c.cause)).toEqual(['regime_retire'])
      expect(l.resume.code).toBe('declaree_a_rectifier')
      // Aujourd’hui la période se juge sous le statut proposé, « à confirmer » : elle ne se déclare pas encore.
      const offre = offreDeDeclaration(l)
      expect(offre.genre).toBe('aucune')
      expect((offre as { pourquoi: string | null }).pourquoi).toContain('Aucun régime confirmé ne couvre le début de la période')
    })

    it('une lecture qui manque au contexte : déclarée, mais rien ne s’affirme de son état', () => {
      const s = deux()
      const l = ligneDu('achats', '2027-10-01', { ...s, ecarts: luEnPartie([], 'tronquée') })
      expect(l.etat?.etat).toBe('indetermine')
      expect(l.resume).toMatchObject({ code: 'declaree_indeterminee', ton: 'neutre' })
      expect(l.resume.detail).toContain('n\'est pas revenue entière (tronquée)')
      expect(offreDeDeclaration(l).genre).toBe('aucune')
      expect(ligneAFaire(l)).toBe(false)
    })

    it('la pièce déclarée retirée du calcul : plus aucune opération, la rectificative à zéro opération se dit sans s’offrir', () => {
      const s = deux()
      // La fiche est retirée : le calcul d’aujourd’hui ne porte plus aucun achat.
      const l = ligneDu('achats', '2027-10-01', { ...s, fiches: lu([fiche({ retire_le: '2027-11-03T10:00:00Z', retire_par: 'u1' })]) })
      expect(l.calcul.etat).toBe('rien_a_declarer')
      expect(l.etat?.etat).toBe('a_rectifier')
      expect(l.etat?.differences.map((d) => d.sorte)).toEqual(['retiree'])
      const offre = offreDeDeclaration(l)
      expect(offre).toMatchObject({ genre: 'aucune' })
      expect((offre as { pourquoi: string }).pourquoi).toContain('ne contient plus aucune opération')
    })

    it('la chaîne : la plus récente d’abord, remplacées comprises, l’active est la seule déclarée', () => {
      const s = deux()
      const initiale = { ...s.declarations.lignes[0], id: D1, etat: 'remplacee' as const, cree_le: '2027-11-01T09:00:00Z' }
      const rectificative: DeclarationEreportingHorsApplication = {
        ...initiale, id: D2, etat: 'declaree', type_transmission: 'RE', remplace_id: D1, cree_le: '2027-11-02T09:00:00Z',
      }
      const l = ligneDu('achats', '2027-10-01', { ...s, declarations: lu([initiale, rectificative]) })
      expect(l.chaine.map((d) => d.id)).toEqual([D2, D1])
      expect(l.active?.id).toBe(D2)
    })

    it('une période seulement remplacée n’a pas d’active : elle se juge comme non déclarée', () => {
      const s = deux()
      const remplacee = { ...s.declarations.lignes[0], etat: 'remplacee' as const }
      const l = ligneDu('achats', '2027-10-01', { ...s, declarations: lu([remplacee]) })
      expect(l.active).toBeNull()
      expect(l.chaine).toHaveLength(1)
      expect(l.resume.code).toBe('a_declarer')
    })
  })

  describe('resumeDeLaLigne', () => {
    it('une cause sans calcul entier dit « à rectifier » ; sans cause, indéterminé', () => {
      const s = sources()
      const calcul = declarationCalculee('achats', OCTOBRE, s, dossier(), AUJOURDHUI)
      const { declaration } = declaree('achats', OCTOBRE)
      const resume = resumeDeLaLigne(periodeDuMois('2027-10-01'), calcul, declaration,
        { etat: 'indetermine', differences: [], causes: [], refus: [], motifs: [] }, AUJOURDHUI)
      expect(resume.code).toBe('declaree_indeterminee')
      expect(resume.detail).toContain('Ce qui a changé depuis ne se sait pas.')
    })
  })
})

describe('lignesDeLEreporting', () => {
  it('trois objets, trois périodes chacun, du plus récent au plus ancien', () => {
    const lignes = lignesDeLEreporting(sources(), dossier(), AUJOURDHUI)
    for (const objet of ['ventes', 'achats', 'paiements'] as const) {
      expect(lignes[objet].map((l) => l.periode.debut), objet).toEqual(['2027-11-01', '2027-10-01', '2027-09-01'])
      expect(lignes[objet].every((l) => l.objet === objet)).toBe(true)
    }
    expect(lignes.achats.map((l) => l.resume.code)).toEqual(['en_cours', 'a_declarer', 'rien_a_declarer'])
  })
})

describe('offreDeDeclaration et saisieDeLaDeclaration', () => {
  const ligneAchats = (s = sources(), d = dossier()) => ligneDePeriode('achats', periodeDe('2027-10-01', 'mois') as NonNullable<ReturnType<typeof periodeDe>>, s, d, AUJOURDHUI)

  it('la saisie d’une initiale : le régime de la période, aucune déclaration remplacée, la plateforme et la note sans leurs blancs', () => {
    const l = ligneAchats()
    const saisie = saisieDeLaDeclaration(l, { plateforme: '  Plateforme fictive  ', note: '  vérifiée  ' })
    expect(saisie).toMatchObject({
      objet: 'achats', debut: '2027-10-01', fin: '2027-10-31', regimeId: R1, remplaceId: null, plateforme: 'Plateforme fictive', note: 'vérifiée',
    })
    expect(saisie?.contenu).toMatchObject({ version: 1, objet: 'achats', debut: '2027-10-01', fin: '2027-10-31', role: 'BY', nombreOperations: 1 })
  })

  it('une plateforme ou une note de blancs part nulle, comme la base la lirait', () => {
    const saisie = saisieDeLaDeclaration(ligneAchats(), { plateforme: '   ', note: ' ' })
    expect(saisie?.plateforme).toBeNull()
    expect(saisie?.note).toBeNull()
  })

  it('la saisie d’une rectificative désigne l’active', () => {
    const { declaration, sources: lignesSources } = declaree('achats', OCTOBRE)
    const l = ligneAchats(sources({ declarations: lu([declaration]), sources: lu(lignesSources) }))
    expect(saisieDeLaDeclaration(l, { plateforme: 'X', note: '' })?.remplaceId).toBe(declaration.id)
  })

  it('sous un régime à confirmer, une période ne produit aucune saisie', () => {
    const l = ligneAchats(sources({ regimes: lu([]) }))
    expect(saisieDeLaDeclaration(l, { plateforme: 'X', note: '' })).toBeNull()
    expect(offreDeDeclaration(l).genre).toBe('aucune')
  })

  it('sous un statut à préciser, le régime confirmé est à reconfirmer : une saisie existerait pour la base, l’écran n’en offre aucune', () => {
    const l = ligneAchats(sources(), dossier({ statut_tva: null }))
    expect(l.calcul.regime?.etat).toBe('a_reconfirmer')
    expect(offreDeDeclaration(l).genre).toBe('aucune')
  })

  it('une saisie complète d’une période déclarable passe les refus de la base, plateforme absente exceptée', () => {
    const s = sources()
    const l = ligneAchats(s)
    const contexte = contexteDeLaDeclaration(s, 'd1', AUJOURDHUI)
    expect(refusDeclaration(saisieDeLaDeclaration(l, { plateforme: '', note: '' }) as NonNullable<ReturnType<typeof saisieDeLaDeclaration>>, contexte)?.cle).toBe('plateforme_absente')
    expect(refusDeclaration(saisieDeLaDeclaration(l, { plateforme: 'Plateforme fictive', note: '' }) as NonNullable<ReturnType<typeof saisieDeLaDeclaration>>, contexte)).toBeNull()
  })

  it('la même saisie des trois objets passe les refus de la base', () => {
    const s = sources()
    const contexte = contexteDeLaDeclaration(s, 'd1', AUJOURDHUI)
    for (const objet of ['ventes', 'achats', 'paiements'] as const) {
      const l = ligneDePeriode(objet, periodeDe('2027-10-01', 'mois') as NonNullable<ReturnType<typeof periodeDe>>, s, dossier(), AUJOURDHUI)
      const saisie = saisieDeLaDeclaration(l, { plateforme: 'Plateforme fictive', note: '' })
      expect(saisie, objet).not.toBeNull()
      expect(refusDeclaration(saisie as NonNullable<typeof saisie>, contexte), objet).toBeNull()
    }
  })

  it('le contexte des refus reprend les lectures du dossier et le jour', () => {
    const s = sources()
    const c = contexteDeLaDeclaration(s, 'd1', AUJOURDHUI)
    expect(c).toMatchObject({ dossierId: 'd1', aujourdHui: AUJOURDHUI })
    expect(c.regimes).toBe(s.regimes.lignes)
    expect(c.declarations).toBe(s.declarations.lignes)
    expect(c.sources).toBe(s.sources.lignes)
    expect(c.fiches).toBe(s.fiches.lignes)
    expect(c.pieces).toBe(s.pieces.lignes)
    expect(c.factures).toBe(s.factures.lignes)
    expect(c.encaissements).toBe(s.encaissements.lignes)
  })
})

describe('les phrases d’une déclaration', () => {
  const calcul = (objet: 'ventes' | 'achats' | 'paiements') => declarationCalculee(objet, OCTOBRE, sources(), dossier(), AUJOURDHUI)

  it('ce qu’un contenu déclare, en une phrase par objet', () => {
    expect(MOIS_SANS_ESPACES(phraseDuContenu('achats', calcul('achats').contenu as NonNullable<ReturnType<typeof calcul>['contenu']>)))
      .toBe('1 facture, 120,00 € hors taxe')
    expect(MOIS_SANS_ESPACES(phraseDuContenu('ventes', calcul('ventes').contenu as NonNullable<ReturnType<typeof calcul>['contenu']>)))
      .toBe('1 facture, 100,00 € hors taxe, 20,00 € de TVA')
    expect(MOIS_SANS_ESPACES(phraseDuContenu('paiements', calcul('paiements').contenu as NonNullable<ReturnType<typeof calcul>['contenu']>)))
      .toBe('1 encaissement, 120,00 € TTC')
  })

  it('une facture en dollars se dit en dollars', () => {
    const s = sources({ fiches: lu([fiche({ devise: 'USD' })]) })
    const c = declarationCalculee('achats', OCTOBRE, { ...s, pieces: lu([piece({ devise: 'USD', montant_devise: 120, montant_ttc: 110 })]) }, dossier(), AUJOURDHUI)
    expect(MOIS_SANS_ESPACES(phraseDuContenu('achats', c.contenu as NonNullable<typeof c.contenu>))).toContain('120,00 $US hors taxe')
    expect(MOIS_SANS_ESPACES(montantEnDevise(12345, 'EUR'))).toBe('123,45 €')
    expect(montantEnDevise(12345, 'XXX-PAS-UNE-DEVISE')).toBe('123,45 XXX-PAS-UNE-DEVISE')
  })

  it('une initiale nomme la plateforme, l’objet, la période, le contenu, et dit qu’elle ne s’efface pas', () => {
    const c = calcul('achats')
    const texte = MOIS_SANS_ESPACES(confirmationDeLaDeclaration({
      objet: 'achats', periode: { libelleDe: 'd’octobre 2027' }, plateforme: 'Plateforme fictive', contenu: c.contenu as NonNullable<typeof c.contenu>, remplace: null,
    }))
    expect(texte).toContain('Vous déclarez avoir transmis sur Plateforme fictive l’e-reporting des achats à l’étranger d’octobre 2027 : 1 facture, 120,00 € hors taxe.')
    expect(texte).toContain('Cette mention ne s’efface pas ; une erreur se corrige par une déclaration rectificative de toute la période.')
    expect(texte).toContain('figé, avec son empreinte')
    expect(texte).not.toContain('RECTIFICATIVE')
  })

  it('une rectificative remplace ENTIÈREMENT l’active, qu’elle nomme', () => {
    const c = calcul('ventes')
    const texte = MOIS_SANS_ESPACES(confirmationDeLaDeclaration({
      objet: 'ventes', periode: { libelleDe: 'd’octobre 2027' }, plateforme: 'Autre plateforme', contenu: c.contenu as NonNullable<typeof c.contenu>,
      remplace: { cree_le: '2027-11-02T09:00:00Z', plateforme: 'Plateforme fictive', nb_operations: 1 },
    }))
    expect(texte).toContain('la déclaration RECTIFICATIVE de l’e-reporting des ventes à des particuliers d’octobre 2027')
    expect(texte).toContain('Elle remplace ENTIÈREMENT celle du 02/11/2027 (Plateforme fictive, 1 opération)')
    expect(texte).toContain('marquée remplacée')
  })

  it('ce que la déclaration gardera se dit avant le clic', () => {
    const c = calcul('paiements')
    const initiale = MOIS_SANS_ESPACES(phraseDeCeQueLaDeclarationGarde('initiale', 'paiements', 'd’octobre 2027', c.contenu as NonNullable<typeof c.contenu>))
    expect(initiale).toBe('La déclaration gardera, figé et empreinté par la base, le contenu que l’application calcule aujourd’hui pour l’e-reporting des paiements des ventes à des particuliers d’octobre 2027 : 1 encaissement, 120,00 € TTC.')
    expect(phraseDeCeQueLaDeclarationGarde('rectificative', 'paiements', 'x', c.contenu as NonNullable<typeof c.contenu>)).toMatch(/^La rectificative gardera/)
  })
})

describe('le contenu en tableau', () => {
  it('un achat par ligne : date, pièce, facture, pays, hors taxe', () => {
    const t = tableauDuContenu('achats', declarationCalculee('achats', OCTOBRE, sources(), dossier(), AUJOURDHUI).contenu as never, sources())
    expect(t.colonnes).toEqual(['Date', 'Pièce', 'Facture', 'Pays', 'Hors taxe'])
    expect(t.lignes.map((l) => l.map(MOIS_SANS_ESPACES))).toEqual([['05/10/2027', 'Editeur Logiciel', 'Facture n° INV-1', 'IE', '120,00 €']])
  })

  it('un avoir se montre en négatif, sous son nom', () => {
    const s = sources({ fiches: lu([fiche({ type_document: '381', facture_origine_numero: 'INV-0', facture_origine_date: '2027-09-05' })]), pieces: lu([piece({ montant_ttc: -120 })]) })
    const c = declarationCalculee('achats', OCTOBRE, s, dossier(), AUJOURDHUI)
    const t = tableauDuContenu('achats', c.contenu as never, s)
    expect(t.lignes[0][2]).toBe('Avoir n° INV-1')
    expect(MOIS_SANS_ESPACES(t.lignes[0][4])).toBe('-120,00 €')
  })

  it('les ventes par jour et catégorie, les paiements par jour', () => {
    const ventes = tableauDuContenu('ventes', declarationCalculee('ventes', OCTOBRE, sources(), dossier(), AUJOURDHUI).contenu as never, sources())
    expect(ventes.colonnes).toEqual(['Jour', 'Catégorie', 'Hors taxe', 'TVA', 'Factures'])
    expect(ventes.lignes.map((l) => l.map(MOIS_SANS_ESPACES))).toEqual([['08/10/2027', 'Services', '100,00 €', '20,00 €', '1']])
    const paiements = tableauDuContenu('paiements', declarationCalculee('paiements', OCTOBRE, sources(), dossier(), AUJOURDHUI).contenu as never, sources())
    expect(paiements.colonnes).toEqual(['Jour', 'Montant TTC', 'Encaissements'])
    expect(paiements.lignes.map((l) => l.map(MOIS_SANS_ESPACES))).toEqual([['15/10/2027', '120,00 €', '1']])
  })

  it('l’option pour les débits se dit', () => {
    const s = sources({ factures: lu([facture({ option_debits: true })]) })
    const t = tableauDuContenu('ventes', declarationCalculee('ventes', OCTOBRE, s, dossier({ tva_sur_debits: true }), AUJOURDHUI).contenu as never, s)
    // Sous un régime qui n’a pas opté, la facture qui a opté est refusée ou écartée : si elle entre, elle le dit.
    for (const l of t.lignes) expect(l[1]).toMatch(/Services( \(option pour les débits\))?/)
  })
})

describe('le détail d’une période en CSV', () => {
  const contenu = (objet: 'achats' | 'ventes' | 'paiements', s = sources()) =>
    declarationCalculee(objet, OCTOBRE, s, dossier(), AUJOURDHUI).contenu as never

  it('un achat par ligne, le BOM, le point-virgule, la virgule décimale, des montants sans symbole', () => {
    const csv = csvDuDetail('achats', contenu('achats'), sources())
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Date;Pièce;Type;N° de facture;Date de la facture;Pays;Devise;Hors taxe',
      '2027-10-05;Editeur Logiciel;Facture;INV-1;2027-10-05;IE;EUR;120,00',
    ])
  })

  it('un avoir est en négatif, et un champ qui porte un point-virgule ou un guillemet est protégé', () => {
    const s = sources({
      fiches: lu([fiche({ type_document: '381', facture_origine_numero: 'INV-0', facture_origine_date: '2027-09-05' })]),
      pieces: lu([piece({ montant_ttc: -120, tiers: 'Editeur; "Logiciel"\nSA' })]),
    })
    const ligne = csvDuDetail('achats', contenu('achats', s), s).split('\r\n')[1]
    expect(ligne).toBe('2027-10-05;"Editeur; ""Logiciel"" SA";Avoir;INV-1;2027-10-05;IE;EUR;-120,00')
  })

  it('les ventes par jour et catégorie, les paiements par jour', () => {
    expect(csvDuDetail('ventes', contenu('ventes'), sources()).slice(1).split('\r\n')).toEqual([
      'Jour;Catégorie;Option pour les débits;Hors taxe;TVA;Factures et avoirs',
      '2027-10-08;Services;non;100,00;20,00;1',
    ])
    expect(csvDuDetail('paiements', contenu('paiements'), sources()).slice(1).split('\r\n')).toEqual([
      'Jour;Montant TTC;Encaissements',
      '2027-10-15;120,00;1',
    ])
  })

  it('le nom du fichier dit l’objet et la période, jamais le dossier', () => {
    expect(nomFichierDuDetail('achats', OCTOBRE)).toBe('e-reporting-achats-2027-10-01-2027-10-31.csv')
    expect(nomFichierDuDetail('paiements', { debut: '2027-09-01', fin: '2027-09-30' })).toBe('e-reporting-paiements-2027-09-01-2027-09-30.csv')
  })
})

describe('ce qui est écarté, ce qui est refusé : les sources nommées', () => {
  it('une source se nomme par sa pièce, sa fiche, sa facture ou son encaissement', () => {
    const s = sources()
    expect(nomDeLaSource({ genre: 'piece', id: P1 }, s)).toBe('la pièce « Editeur Logiciel »')
    expect(nomDeLaSource({ genre: 'fiche', id: F1 }, s)).toBe('la fiche de la pièce « Editeur Logiciel »')
    expect(nomDeLaSource({ genre: 'facture', id: V1 }, s)).toBe('la facture F2027-0001')
    expect(nomDeLaSource({ genre: 'encaissement', id: E1 }, s)).toBe('l’encaissement du 15/10/2027')
    expect(nomDeLaSource({ genre: 'lecture', id: 'fiches' }, s)).toBe('la lecture fiches')
    // Une source qu’on ne retrouve pas ne se nomme pas au hasard.
    expect(nomDeLaSource({ genre: 'piece', id: 'inconnue' }, s)).toBe('la pièce « une pièce »')
    expect(nomDeLaSource({ genre: 'fiche', id: 'inconnue' }, s)).toBe('une fiche')
    expect(nomDeLaSource({ genre: 'facture', id: 'inconnue' }, s)).toBe('une facture')
    expect(nomDeLaSource({ genre: 'encaissement', id: 'inconnue' }, s)).toBe('un encaissement')
  })

  it('le nom d’une pièce : son tiers, sinon son fichier', () => {
    expect(nomDeLaPiece([piece({ tiers: '  Editeur  ' })], P1)).toBe('Editeur')
    expect(nomDeLaPiece([piece({ tiers: null })], P1)).toBe('facture-logiciel.pdf')
    expect(nomDeLaPiece([piece({ tiers: '   ' })], P1)).toBe('facture-logiciel.pdf')
  })

  it('les sources d’un refus : sans doublon, sans lecture, cinq au plus', () => {
    const sept = Array.from({ length: 7 }, (_, i) => piece({ id: `p${i}`, tiers: `Tiers ${i}` }))
    const s = sources({ pieces: lu([piece(), ...sept]) })
    const refus = (sourcesDuRefus_: { genre: 'piece' | 'lecture'; id: string }[]) => ({ cle: 'achat_a_verifier' as const, message: 'm', sources: sourcesDuRefus_ })
    expect(sourcesDuRefus(refus([{ genre: 'piece', id: P1 }, { genre: 'piece', id: P1 }]), s)).toBe('la pièce « Editeur Logiciel »')
    expect(sourcesDuRefus(refus([{ genre: 'lecture', id: 'pieces' }]), s)).toBe('')
    expect(sourcesDuRefus(refus(sept.map((p) => ({ genre: 'piece' as const, id: p.id }))), s))
      .toBe('la pièce « Tiers 0 », la pièce « Tiers 1 », la pièce « Tiers 2 », la pièce « Tiers 3 », la pièce « Tiers 4 » et 2 autre(s)')
  })
})

describe('à rectifier, en mots', () => {
  const s = sources()

  it('une opération ajoutée, retirée, changée', () => {
    expect(motsDeLaDifference({ sorte: 'ajoutee', cle: P1, date: '2027-10-05', champs: [], sourcesAjoutees: [], sourcesRetirees: [] }, 'achats', s))
      .toBe('L’achat de la pièce « Editeur Logiciel » est ajoutée depuis : la déclaration ne la portait pas.')
    expect(motsDeLaDifference({ sorte: 'retiree', cle: P1, date: '2027-10-05', champs: [], sourcesAjoutees: [], sourcesRetirees: [] }, 'achats', s))
      .toBe('L’achat de la pièce « Editeur Logiciel » est retirée depuis : la déclaration la portait.')
    expect(motsDeLaDifference({ sorte: 'changee', cle: P1, date: '2027-10-05', champs: ['numero', 'htCentimes'], sourcesAjoutees: [], sourcesRetirees: [] }, 'achats', s))
      .toBe('L’achat de la pièce « Editeur Logiciel » a changé : le numéro de la facture, le hors-taxe.')
    // Une nouvelle version de la fiche change la source d’un achat sans rien changer d’autre : cela ne se dit pas.
    expect(motsDeLaDifference({ sorte: 'changee', cle: P1, date: '2027-10-05', champs: ['numero'], sourcesAjoutees: [{ genre: 'fiche', id: F2 }], sourcesRetirees: [{ genre: 'fiche', id: F1 }] }, 'achats', s))
      .toBe('L’achat de la pièce « Editeur Logiciel » a changé : le numéro de la facture.')
  })

  it('les ventes et les paiements, par jour ; le déclarant ; une source de plus ou de moins ; un champ inconnu se garde tel quel', () => {
    expect(motsDeLaDifference({ sorte: 'changee', cle: '2027-10-08|TPS1|false', date: '2027-10-08', champs: ['tvaCentimes'], sourcesAjoutees: [{ genre: 'facture', id: V2 }], sourcesRetirees: [] }, 'ventes', s))
      .toBe('Les ventes du 08/10/2027 (services) a changé : la TVA, 1 source(s) de plus.')
    expect(motsDeLaDifference({ sorte: 'ajoutee', cle: '2027-10-08|TLB1|true', date: '2027-10-08', champs: [], sourcesAjoutees: [], sourcesRetirees: [] }, 'ventes', s))
      .toContain('Les ventes du 08/10/2027 (biens, option pour les débits)')
    expect(motsDeLaDifference({ sorte: 'retiree', cle: '2027-10-15', date: '2027-10-15', champs: [], sourcesAjoutees: [], sourcesRetirees: [] }, 'paiements', s))
      .toBe('Les paiements du 15/10/2027 est retirée depuis : la déclaration la portait.')
    expect(motsDeLaDifference({ sorte: 'changee', cle: 'declarant', date: null, champs: ['siren', 'numeroTva', 'inconnu'], sourcesAjoutees: [], sourcesRetirees: [{ genre: 'facture', id: V1 }] }, 'ventes', s))
      .toBe('Le déclarant a changé : le SIREN du déclarant, le numéro de TVA du déclarant, inconnu, 1 source(s) de moins.')
  })

  it('chaque cause se dit, avec le nom de la pièce et le jour', () => {
    expect(motsDeLaCause({ cause: 'regime_retire', regimeId: R1, le: '2027-11-03T10:00:00Z' }, s)).toContain('retiré le 03/11/2027')
    expect(motsDeLaCause({ cause: 'ecart_retire', pieceId: P1, le: '2027-11-03T10:00:00Z' }, s))
      .toBe('La pièce « Editeur Logiciel » était écartée au moment de la déclaration, et reprise le 03/11/2027 : elle est de nouveau à vérifier.')
    expect(motsDeLaCause({ cause: 'fiche_posee_apres', pieceId: P1, ficheId: F1, le: '2027-11-03T10:00:00Z' }, s))
      .toContain('Une fiche « fournisseur établi hors de France » a été posée le 03/11/2027 sur la pièce « Editeur Logiciel »')
    expect(motsDeLaCause({ cause: 'fiche_changee_apres', pieceId: P1, ficheId: F1, le: '2027-11-03T10:00:00Z' }, s))
      .toContain('La fiche de la pièce « Editeur Logiciel » a été remplacée ou retirée le 03/11/2027')
  })
})

describe('le régime', () => {
  it('aucun régime confirmé en vigueur : « aucun » ; un régime qui ne commence que dans l’avenir ne compte pas', () => {
    expect(etatDuRegime([], dossier(), AUJOURDHUI)).toEqual({ etat: 'aucun' })
    expect(etatDuRegime([regime({ depuis: '2027-12-01' })], dossier(), AUJOURDHUI)).toEqual({ etat: 'aucun' })
    expect(etatDuRegime([regime({ retire_le: '2027-11-01T10:00:00Z', retire_par: 'u1' })], dossier(), AUJOURDHUI)).toEqual({ etat: 'aucun' })
  })

  it('le régime en vigueur, et s’il se reconfirme : l’onglet TVA n’est plus son statut', () => {
    const r = regime()
    expect(etatDuRegime([r], dossier(), AUJOURDHUI)).toEqual({ etat: 'en_vigueur', regime: r, aReconfirmer: false, statutAPreciser: false })
    expect(etatDuRegime([r], dossier({ statut_tva: 'franchise' }), AUJOURDHUI)).toMatchObject({ aReconfirmer: true })
    expect(etatDuRegime([r], dossier({ tva_periodicite: 'mensuelle' }), AUJOURDHUI)).toMatchObject({ aReconfirmer: true })
    expect(etatDuRegime([r], dossier({ tva_sur_debits: true }), AUJOURDHUI)).toMatchObject({ aReconfirmer: true })
    expect(etatDuRegime([r], dossier({ article_exoneration: 'cgi_261_4_1' }), AUJOURDHUI)).toMatchObject({ aReconfirmer: true })
  })

  it('un statut à préciser ne se compare à rien : il ne fait pas reconfirmer', () => {
    expect(etatDuRegime([regime()], dossier({ statut_tva: null }), AUJOURDHUI))
      .toMatchObject({ etat: 'en_vigueur', aReconfirmer: false, statutAPreciser: true })
  })

  it('le régime le plus récent en vigueur l’emporte, les autres régimes du dossier sont ignorés', () => {
    const ancien = regime({ id: 'r0', depuis: '2026-01-01' })
    const recent = regime({ id: R2, depuis: '2027-06-01', statut_tva: 'franchise', tva_periodicite: null, frequence_transactions: 'bimestre', frequence_paiements: 'bimestre' })
    const autreDossier = regime({ id: 'r9', dossier_id: 'd2', depuis: '2027-10-01' })
    expect(etatDuRegime([ancien, recent, autreDossier], dossier({ statut_tva: 'franchise' }), AUJOURDHUI))
      .toMatchObject({ regime: recent, aReconfirmer: false })
  })

  it('les fréquences, en mots', () => {
    expect(phraseDesFrequences({ frequence_transactions: 'decade', frequence_paiements: 'mois' }))
      .toBe('ses ventes et ses achats se déclarent par décade ; ses paiements se déclarent chaque mois')
    expect(phraseDesFrequences({ frequence_transactions: 'bimestre', frequence_paiements: 'bimestre' }))
      .toBe('ses ventes et ses achats se déclarent tous les deux mois ; ses paiements se déclarent tous les deux mois')
    expect(phraseDesFrequences({ frequence_transactions: 'mois', frequence_paiements: null }))
      .toBe('ses ventes et ses achats se déclarent chaque mois ; ses paiements ne se déclarent pas (option pour la TVA sur les débits)')
  })

  it('la carte dit ce que le dossier déclare, sous son statut d’aujourd’hui', () => {
    expect(obligationsDeLaCarte(dossier()).map((o) => [o.objet, o.etat, o.frequence])).toEqual([
      ['achats', 'due', 'chaque mois'], ['ventes', 'due', 'chaque mois'], ['paiements', 'due', 'chaque mois'],
    ])
    // Un exonéré déclare ses achats à l’étranger (obligation due), ses ventes « le cas échéant » ; la fréquence est à confirmer.
    const exo = obligationsDeLaCarte(dossier({ statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1' }))
    expect(exo.map((o) => [o.objet, o.etat])).toEqual([['achats', 'due'], ['ventes', 'le_cas_echeant'], ['paiements', 'le_cas_echeant']])
    expect(exo[0].frequence).toContain('fréquence à confirmer')
    // Un statut à préciser : les achats sont dus, le reste est à préciser.
    expect(obligationsDeLaCarte(dossier({ statut_tva: null })).map((o) => [o.objet, o.etat]))
      .toEqual([['achats', 'due'], ['ventes', 'a_preciser'], ['paiements', 'a_preciser']])
    // Sur option pour les débits, aucun paiement n’est dû.
    expect(obligationsDeLaCarte(dossier({ tva_sur_debits: true })).find((o) => o.objet === 'paiements')).toMatchObject({ etat: 'non_due', frequence: null })
  })

  it('la confirmation d’un régime nomme le jour, le régime et ses fréquences, et dit qu’il ne se modifie pas', () => {
    const texte = confirmationDuRegime(
      { depuis: '2027-09-01', statut_tva: 'redevable', article_exoneration: null, tva_periodicite: 'trimestrielle', tva_sur_debits: false, frequence_transactions: 'mois', frequence_paiements: 'mois', note: null },
      'redevable, chaque mois', 'ses ventes et ses achats se déclarent chaque mois',
    )
    expect(texte).toContain('à partir du 01/09/2027')
    expect(texte).toContain('« redevable, chaque mois »')
    expect(texte).toContain('ses ventes et ses achats se déclarent chaque mois')
    expect(texte).toContain('Il ne se modifie pas : une erreur se retire')
  })

  it('le retrait d’un régime dit ce qu’il laisse derrière lui, d’après les déclarations lues', () => {
    const r = regime()
    const dec = (regime_id: string, etat: 'declaree' | 'remplacee') => ({ regime_id, etat })
    expect(confirmationDuRetraitDuRegime(r, lu([]))).toContain('Aucune déclaration n’a été faite sous ce régime.')
    expect(confirmationDuRetraitDuRegime(r, lu([dec(R1, 'declaree')]))).toContain('1 déclaration faite sous ce régime reste déclarée et se dira à rectifier.')
    expect(confirmationDuRetraitDuRegime(r, lu([dec(R1, 'declaree'), dec(R1, 'declaree'), dec(R1, 'remplacee'), dec(R2, 'declaree')])))
      .toContain('2 déclarations faites sous ce régime restent déclarées et se diront à rectifier.')
    expect(confirmationDuRetraitDuRegime(r, luEnPartie([dec(R1, 'declaree')], 'm'))).toContain('n’ont pas pu être lues en entier')
    expect(confirmationDuRetraitDuRegime(r, lu([]))).toMatch(/^Retirer le régime « redevable, chaque mois » confirmé à partir du 01\/01\/2026 \?/)
  })
})

describe('la pièce écartée, les confirmations', () => {
  it('un écart nomme la pièce et son motif, et dit qu’il se reprend', () => {
    const t = confirmationDeLEcart('Editeur Logiciel', '  Fournisseur établi en France.  ')
    expect(t).toContain('Écarter la pièce « Editeur Logiciel » de l’e-reporting ?')
    expect(t).toContain('Motif : Fournisseur établi en France.')
    expect(t).toContain('L’écart reste dans l’historique et se reprend')
  })

  it('une reprise nomme la pièce, et dit qu’une période déclarée pendant l’écart peut se dire à rectifier', () => {
    const t = confirmationDeLaReprise('Editeur Logiciel')
    expect(t).toContain('Reprendre la pièce « Editeur Logiciel » ?')
    expect(t).toContain('de nouveau à vérifier')
    expect(t).toContain('peut se dire à rectifier')
  })
})

describe('la pièce dont la fiche est déclarée (hypothèse E5-Q6)', () => {
  const { declaration, sources: lignesSources } = declaree('achats', OCTOBRE)
  const fiches = (motif: string | null = null) => ({ fiches: [fiche()], motif })
  const decl = (o: Partial<{ declarations: ReturnType<typeof lu<typeof declaration>>; sources: ReturnType<typeof lu<(typeof lignesSources)[number]>>; motif: string | null }> = {}) => ({
    declarations: lu([declaration]), sources: lu(lignesSources), motif: null, ...o,
  })

  it('retenue : le message de la base, avec les bornes de la période', () => {
    const r = pieceDeclaree(P1, fiches(), decl())
    expect(r).toEqual({
      sait: true,
      message: 'Cette pièce est déclarée à l\'e-reporting des achats du 01/10/2027 au 31/10/2027 : elle ne se supprime plus, sauf avec son dossier — une erreur se corrige par une déclaration rectificative de la période.',
    })
  })

  it('une autre pièce, une déclaration remplacée, une source d’un autre genre : rien ne la retient', () => {
    expect(pieceDeclaree(P2, fiches(), decl())).toBeNull()
    expect(pieceDeclaree(P1, fiches(), decl({ declarations: lu([{ ...declaration, etat: 'remplacee' as const }]) }))).toBeNull()
    expect(pieceDeclaree(P1, fiches(), decl({ sources: lu(lignesSources.map((x) => ({ ...x, genre: 'facture' as const }))) }))).toBeNull()
  })

  it('une lecture absente ou partielle ne dit rien de la pièce : on ne sait pas', () => {
    for (const r of [
      pieceDeclaree(P1, null, decl()),
      pieceDeclaree(P1, fiches('tronquée'), decl()),
      pieceDeclaree(P1, fiches(), null),
      pieceDeclaree(P1, fiches(), decl({ declarations: luEnPartie([declaration], 'tronquée'), motif: 'tronquée' })),
      // Le motif commun des deux lectures suffit à ne rien dire.
      pieceDeclaree(P1, fiches(), decl({ motif: 'tronquée' })),
      pieceDeclaree(P1, fiches(), decl({ sources: luEnPartie(lignesSources, 'tronquée'), motif: 'tronquée' })),
      // Le drapeau de chaque lecture vaut à lui seul, même quand le motif commun n'a pas été posé.
      pieceDeclaree(P1, fiches(), decl({ declarations: luEnPartie([declaration], 'tronquée') })),
      pieceDeclaree(P1, fiches(), decl({ sources: luEnPartie(lignesSources, 'tronquée') })),
    ]) {
      expect(r?.sait).toBe(false)
      expect(r?.message).toContain('n’ont pas pu être lues en entier')
    }
  })
})

describe('les lignes d’un monde vide, et d’un monde plein', () => {
  it('un dossier sans rien : aucune ligne avant septembre 2027 ; après, la période en cours attend, les autres n’ont rien', () => {
    const vide = sources({
      regimes: lu([]), pieces: lu([]), fiches: lu([]), taux: lu([]), factures: lu([]), lignes: lu([]), encaissements: lu([]), parts: lu([]),
    })
    expect(lignesDeLEreporting(vide, dossier(), '2027-08-01')).toEqual({ ventes: [], achats: [], paiements: [] })
    const apres = lignesDeLEreporting(vide, dossier(), AUJOURDHUI)
    expect(apres.achats.map((l) => l.resume.code)).toEqual(['en_cours', 'rien_a_declarer', 'rien_a_declarer'])
  })

  it('les trois objets d’un monde plein ne se mêlent pas : un rôle chacun', () => {
    const plein = lignesDeLEreporting(sources(), dossier(), AUJOURDHUI)
    expect(plein.ventes[1].calcul.contenu).toMatchObject({ role: 'SE', nombreOperations: 1 })
    expect(plein.achats[1].calcul.contenu).toMatchObject({ role: 'BY', nombreOperations: 1 })
    expect(plein.paiements[1].calcul.contenu).toMatchObject({ role: 'SE', nombreOperations: 1 })
  })
})

describe('un encaissement retiré', () => {
  const octobre = periodeDe('2027-10-01', 'mois') as NonNullable<ReturnType<typeof periodeDe>>

  it('ne fait pas partie du contenu des paiements', () => {
    const s = sources({ encaissements: lu([encaissement({ retire_le: '2027-10-20T10:00:00Z' })]) })
    expect(ligneDePeriode('paiements', octobre, s, dossier(), AUJOURDHUI).resume.code).toBe('rien_a_declarer')
  })

  it('retiré après la déclaration de sa période : à rectifier, et la rectificative à blanc ne s’offre pas', () => {
    const { declaration, sources: lignesSources } = declaree('paiements', OCTOBRE)
    const s = sources({
      declarations: lu([declaration]), sources: lu(lignesSources),
      encaissements: lu([encaissement({ retire_le: '2027-11-03T10:00:00Z' })]), parts: lu([part()]),
    })
    const l = ligneDePeriode('paiements', octobre, s, dossier(), AUJOURDHUI)
    expect(l.etat?.etat).toBe('a_rectifier')
    expect(l.etat?.differences.map((d) => d.sorte)).toEqual(['retiree'])
    expect(offreDeDeclaration(l).genre).toBe('aucune')
  })
})
