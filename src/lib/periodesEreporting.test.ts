import { afterEach, describe, expect, it } from 'vitest'
import { ajouterJours } from './format'
import {
  DEBUT_EREPORTING_PME,
  PRUDENCE_DEUXIEME_DECADE,
  PRUDENCE_FIN_DE_MOIS,
  calendrierEreporting,
  dansLObligation,
  frequenceDesPaiements,
  frequenceDesTransactions,
  libelleFrequence,
  obligationsEreporting,
  periodeDe,
  transmissionAttendue,
  type FrequenceEreporting,
  type PeriodeEreporting,
} from './periodesEreporting'
import type { PeriodiciteTva } from './types'

// CHAQUE ATTENDU EST RECOPIÉ D'UNE SOURCE, JAMAIS DU MODULE : la ligne de commentaire qui précède un cas dit d'où il
// vient. Les sources (lues le 09/10/2026) :
//   [D10]  BOI-TVA-DECLA-20-30-50, 30/09/2026, §10 et §20 (le calendrier ; la franchise en base) ;
//   [C]    BOI-TVA-DECLA-20-30-50-10, 30/09/2026, §20 (les opérations exonérées en sortent), §60 (les achats) ;
//   [M]    BOI-TVA-DECLA-20-30-50-30, 30/09/2026, §40 à §100 (fréquences et délais des transactions) ;
//   [P]    BOI-TVA-DECLA-20-30-60, 30/09/2026, §1, §30, §170 à §210 (les paiements) ;
//   [FICHE] impots.gouv.fr, « Fréquences et délais de transmission des données de transaction et de paiement », MAJ
//          août 2026 ;
//   [T13]  spécifications externes de la DGFiP v3.2 (30/04/2026), tableau 13 et sa note 126 ;
//   [RSI]  impots.gouv.fr, actualité « Le régime simplifié d'imposition à la TVA est supprimé à compter du 1er janvier
//          2027 », 22/09/2026 ;
//   [TAB]  impots.gouv.fr, « E-reporting – Tableau des opérations situées dans le champ » ;
//   [FAQ]  impots.gouv.fr, FAQ « J'approfondis la facturation électronique », 01/09/2026, §4.1 ;
//   [SANTE] BOI-TVA-CHAMP-30-10-20-10, 09/04/2025, §20 et §80 (les actes taxables d'un praticien) ;
//   [CONC] la conception de l'e-reporting (09/10/2026), §6.3 : ses points NON VÉRIFIÉS 3 et 9, qui font les « à confirmer ».

const ATTENDUE = (debut: string, fin: string, echeance: string) => ({ debut, fin, echeance })
const bornes = (p: PeriodeEreporting | null) => (p == null ? null : { debut: p.debut, fin: p.fin, echeance: p.echeance })

describe('le calendrier de l’obligation', () => {
  it('une PME ou une micro-entreprise y entre au 1er septembre 2027', () => {
    // [D10] §10 : « 1er septembre 2027 pour les petites et moyennes entreprises et les micro-entreprises » ; [P] §1 de même.
    expect(DEBUT_EREPORTING_PME).toBe('2027-09-01')
  })

  it('la facture — à défaut, l’opération — du 31 août 2027 n’y entre pas, celle du 1er septembre si', () => {
    // [D10] §10 et [P] §1 : « aux factures émises ou, à défaut, aux opérations dont le fait générateur intervient à
    // compter du » 1er septembre 2027.
    expect(dansLObligation('2027-08-31')).toBe(false)
    expect(dansLObligation('2027-09-01')).toBe(true)
    expect(dansLObligation('2031-01-15')).toBe(true)
    // Une date qui n'en est pas une n'entre dans rien.
    for (const date of ['', '2027-09-31', '2027-13-01', '01/09/2027', '2027-9-01']) expect(dansLObligation(date), date).toBe(false)
  })
})

describe('les fréquences proposées', () => {
  it('au réel normal mensuel, les transactions par décade ; au trimestriel, chaque mois — écrites', () => {
    // [M] §50 : « trois transmissions par mois » au réel normal mensuel ; [RSI] : « Réel normal mensuel (RNM) | Par décade ».
    expect(frequenceDesTransactions('redevable', 'mensuelle')).toEqual({ frequence: 'decade', certitude: 'ecrite', raison: null })
    // [M] §60 : au réel normal trimestriel, « la transmission des données de transaction est mensuelle » ; [RSI] : « 1 fois par mois ».
    expect(frequenceDesTransactions('redevable', 'trimestrielle')).toEqual({ frequence: 'mois', certitude: 'ecrite', raison: null })
  })

  it('en franchise en base, les transactions et les paiements tous les bimestres civils, quelle que soit la périodicité', () => {
    for (const periodicite of ['mensuelle', 'trimestrielle'] as PeriodiciteTva[]) {
      // [M] §70 : « les données de transaction sont transmises tous les bimestres civils ».
      expect(frequenceDesTransactions('franchise', periodicite)).toEqual({ frequence: 'bimestre', certitude: 'ecrite', raison: null })
    }
    // [P] §180 : « une transmission tous les bimestres civils ».
    expect(frequenceDesPaiements('franchise')).toEqual({ frequence: 'bimestre', certitude: 'ecrite', raison: null })
  })

  it('au réel, les paiements chaque mois, mensuel comme trimestriel — écrit', () => {
    // [P] §170 : « régime réel normal, mensuel ou trimestriel […] une transmission par mois calendaire ».
    expect(frequenceDesPaiements('redevable')).toEqual({ frequence: 'mois', certitude: 'ecrite', raison: null })
  })

  it('un dossier exonéré : chaque mois, À CONFIRMER, et la raison le dit — sa périodicité n’y change rien', () => {
    // [CONC] point 3 : aucune source ne dit la fréquence d'un exonéré ; « réel normal présumé (trimestriel, donc mensuel ».
    for (const periodicite of ['mensuelle', 'trimestrielle'] as PeriodiciteTva[]) {
      const transactions = frequenceDesTransactions('exonere', periodicite)
      expect(transactions).toMatchObject({ frequence: 'mois', certitude: 'a_confirmer' })
      expect(transactions?.raison).toMatch(/ne la disent pas pour un dossier exonéré/)
      expect(transactions?.raison).toMatch(/à confirmer avec son service des impôts/)
    }
    expect(frequenceDesPaiements('exonere')).toMatchObject({ frequence: 'mois', certitude: 'a_confirmer' })
  })

  it('un statut à préciser ne se voit proposer aucune fréquence', () => {
    expect(frequenceDesTransactions(null, 'trimestrielle')).toBeNull()
    expect(frequenceDesTransactions(null, 'mensuelle')).toBeNull()
    expect(frequenceDesPaiements(null)).toBeNull()
  })

  it('se dit en français, et une fréquence à confirmer le dit, en bref ou avec sa raison', () => {
    expect(libelleFrequence({ frequence: 'decade', certitude: 'ecrite', raison: null }, true)).toBe('par décade')
    expect(libelleFrequence({ frequence: 'mois', certitude: 'ecrite', raison: null }, true)).toBe('chaque mois')
    expect(libelleFrequence({ frequence: 'bimestre', certitude: 'ecrite', raison: null }, false)).toBe('tous les deux mois')
    const aConfirmer = { frequence: 'mois' as const, certitude: 'a_confirmer' as const, raison: 'les textes ne la disent pas' }
    expect(libelleFrequence(aConfirmer, false)).toBe('chaque mois (fréquence à confirmer)')
    expect(libelleFrequence(aConfirmer, true)).toBe('chaque mois (fréquence à confirmer : les textes ne la disent pas)')
  })
})

describe('qui y est tenu, et de quoi', () => {
  it('un dossier exonéré déclare ses ACHATS à l’étranger : due — c’est ce que l’application taisait', () => {
    const o = obligationsEreporting('exonere', 'cgi_261_4_1', 'trimestrielle', false)
    // [C] §60 : « L'assujetti établi en France doit transmettre […] les données de transaction des opérations […] dont
    // il est le destinataire ou le preneur et qu'il a acquis auprès d'un assujetti non établi en France » ; [TAB] : un
    // « Achat de prestations de formation auprès d'un assujetti allemand » se déclare « par le destinataire ».
    expect(o.achats).toMatchObject({ objet: 'achats', etat: 'due', depuis: '2027-09-01' })
    expect(o.achats.frequence).toMatchObject({ frequence: 'mois', certitude: 'a_confirmer' })
  })

  it('un dossier exonéré : ses ventes et ses paiements, le cas échéant — ses opérations exonérées en sortent, pas les autres', () => {
    const o = obligationsEreporting('exonere', 'cgi_261_4_1', 'trimestrielle', false)
    // [C] §20 : les opérations exonérées par les art. 261 à 261 E sont exclues ; [SANTE] §20 et §80 : la location de
    // locaux aménagés, même à des confrères, et les expertises médicales sont taxables — elles y entrent, s'il en a.
    expect(o.ventes).toMatchObject({ etat: 'le_cas_echeant', depuis: '2027-09-01' })
    expect(o.paiements).toMatchObject({ etat: 'le_cas_echeant', depuis: '2027-09-01' })
    expect(o.ventes.frequence?.certitude).toBe('a_confirmer')
    // Aucun « non dû » : c'était le texte faux.
    expect(Object.values(o).map((x) => x.etat)).not.toContain('non_due')
  })

  it('un franchisé est tenu de ses ventes, de ses achats et de ses paiements, tous les deux mois', () => {
    // [D10] §20 : « L'obligation de transmission des données de transaction s'impose aux assujettis qui bénéficient de la
    // franchise en base » ; [M] §40 : la fréquence vaut « quelle que soit l'opération effectuée » ; [P] §180.
    const o = obligationsEreporting('franchise', null, 'trimestrielle', false)
    for (const x of Object.values(o)) {
      expect(x, x.objet).toMatchObject({ etat: 'due', depuis: '2027-09-01', frequence: { frequence: 'bimestre', certitude: 'ecrite' } })
    }
    // L'option pour les débits ne regarde pas un franchisé, qui ne facture pas de TVA.
    expect(obligationsEreporting('franchise', null, 'trimestrielle', true).paiements.etat).toBe('due')
  })

  it('un redevable mensuel : ventes et achats par décade, paiements chaque mois', () => {
    const o = obligationsEreporting('redevable', null, 'mensuelle', false)
    // [M] §40 et §50 ; [P] §170.
    expect(o.ventes).toMatchObject({ etat: 'due', frequence: { frequence: 'decade' } })
    expect(o.achats).toMatchObject({ etat: 'due', frequence: { frequence: 'decade' } })
    expect(o.paiements).toMatchObject({ etat: 'due', frequence: { frequence: 'mois' } })
  })

  it('sur option pour les débits, un redevable n’a pas de paiements à transmettre', () => {
    // [P] §30, sa tolérance ; [FAQ] §4.1 : « les données de paiement ne sont pas attendues […] si l'entreprise a opté
    // pour le paiement de la TVA sur les débits ».
    const o = obligationsEreporting('redevable', null, 'trimestrielle', true)
    expect(o.paiements).toEqual({ objet: 'paiements', etat: 'non_due', depuis: null, frequence: null })
    expect(o.ventes.etat).toBe('due')
    expect(o.achats.etat).toBe('due')
  })

  it('un redevable en partie exonéré : ses ventes et ses paiements en partie, ses achats en entier', () => {
    // [C] §20 pour la part exonérée ; [C] §60 ne distingue pas : un achat à l'étranger se déclare.
    const o = obligationsEreporting('redevable', 'cgi_261_4_1', 'trimestrielle', false)
    expect([o.ventes.etat, o.achats.etat, o.paiements.etat]).toEqual(['en_partie', 'due', 'en_partie'])
  })

  it('un statut à préciser : ses achats sont dus, le reste est à préciser', () => {
    // [C] §60 vise tout assujetti établi en France : le statut n'y change rien, seule la fréquence en dépend.
    const o = obligationsEreporting(null, null, 'trimestrielle', false)
    expect(o.achats).toEqual({ objet: 'achats', etat: 'due', depuis: '2027-09-01', frequence: null })
    expect(o.ventes).toEqual({ objet: 'ventes', etat: 'a_preciser', depuis: null, frequence: null })
    expect(o.paiements).toEqual({ objet: 'paiements', etat: 'a_preciser', depuis: null, frequence: null })
  })
})

describe('aucune transmission « à blanc »', () => {
  it('une période sans opération n’attend aucune transmission de ventes ni d’achats — écrit', () => {
    // [M] §80 : « En l'absence d'opérations réalisées sur une période concernée, aucune transmission n'est attendue. »
    for (const objet of ['ventes', 'achats'] as const) {
      expect(transmissionAttendue(objet, 0)).toMatchObject({ attendue: false, certitude: 'ecrite' })
    }
  })

  it('ni de paiements — à confirmer : les textes ne l’écrivent que des transactions', () => {
    // [CONC] point 9 : l'absence d'envoi à blanc n'est écrite que pour les transactions.
    const r = transmissionAttendue('paiements', 0)
    expect(r).toMatchObject({ attendue: false, certitude: 'a_confirmer' })
    expect(r?.raison).toMatch(/à confirmer/)
  })

  it('une période qui compte des opérations attend sa transmission', () => {
    for (const objet of ['ventes', 'achats', 'paiements'] as const) expect(transmissionAttendue(objet, 3)?.attendue).toBe(true)
  })

  it('un compte qui n’en est pas un ne dit rien', () => {
    for (const n of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(transmissionAttendue('ventes', n), String(n)).toBeNull()
  })
})

describe('periodeDe — la décade du réel normal mensuel', () => {
  it('du 1er au 10 : à déposer le 20', () => {
    // [M] §50 « entre le 1er et le 10 du mois » ; §90 « dans un délai de dix jours suivant la fin de la période » ;
    // [FICHE] « période 1 : 20 du mois » ; [T13] « Le 20 du mois de la période concernée ».
    expect(bornes(periodeDe('2027-09-05', 'decade'))).toEqual(ATTENDUE('2027-09-01', '2027-09-10', '2027-09-20'))
    expect(bornes(periodeDe('2027-09-01', 'decade'))).toEqual(ATTENDUE('2027-09-01', '2027-09-10', '2027-09-20'))
    expect(bornes(periodeDe('2027-09-10', 'decade'))).toEqual(ATTENDUE('2027-09-01', '2027-09-10', '2027-09-20'))
    expect(periodeDe('2027-09-05', 'decade')?.prudence).toBeNull()
  })

  it('du 11 au 20 d’un mois de trente jours : le 30, et les sources s’accordent', () => {
    // [M] §90 (dix jours après le 20) ; [FICHE] « période 2 : 30 du mois » ; [T13] « Dernier jour du mois » — le 30 ici.
    expect(bornes(periodeDe('2027-09-11', 'decade'))).toEqual(ATTENDUE('2027-09-11', '2027-09-20', '2027-09-30'))
    expect(bornes(periodeDe('2027-09-20', 'decade'))).toEqual(ATTENDUE('2027-09-11', '2027-09-20', '2027-09-30'))
    expect(periodeDe('2027-11-15', 'decade')?.echeance).toBe('2027-11-30')
    expect(periodeDe('2027-09-15', 'decade')?.prudence).toBeNull()
  })

  it('du 11 au 20 d’un mois de trente et un jours : le 30, plus tôt que le 31 du tableau 13 — et il le dit', () => {
    // [M] §90 et [FICHE] : le 30 ; [T13] : « Dernier jour du mois », le 31 : le plus tôt est retenu.
    expect(bornes(periodeDe('2027-10-15', 'decade'))).toEqual(ATTENDUE('2027-10-11', '2027-10-20', '2027-10-30'))
    expect(periodeDe('2027-12-20', 'decade')?.echeance).toBe('2027-12-30')
    expect(periodeDe('2027-10-15', 'decade')?.prudence).toBe(PRUDENCE_DEUXIEME_DECADE)
  })

  it('du 11 au 20 février : le dernier jour de février, 28 ou 29', () => {
    // [FICHE] « 30 du mois* », « *sauf mois de février » ; [T13] « Dernier jour du mois » ; [M] §90 donnerait le 2 mars
    // (le 1er en année bissextile) : le dernier jour de février est le plus tôt.
    expect(bornes(periodeDe('2027-02-15', 'decade'))).toEqual(ATTENDUE('2027-02-11', '2027-02-20', '2027-02-28'))
    expect(bornes(periodeDe('2028-02-15', 'decade'))).toEqual(ATTENDUE('2028-02-11', '2028-02-20', '2028-02-29'))
    expect(periodeDe('2028-02-15', 'decade')?.prudence).toBe(PRUDENCE_DEUXIEME_DECADE)
  })

  it('du 21 à la fin du mois : le 10 du mois suivant — décembre passe en janvier, février finit le 28 ou le 29', () => {
    // [M] §50 « jusqu'au dernier jour du mois » ; [FICHE] « période 3 : du 21 à la fin du mois », « 10 du mois suivant » ;
    // [T13] « Le 10 du mois suivant la période concernée ».
    expect(bornes(periodeDe('2027-09-21', 'decade'))).toEqual(ATTENDUE('2027-09-21', '2027-09-30', '2027-10-10'))
    expect(bornes(periodeDe('2027-12-31', 'decade'))).toEqual(ATTENDUE('2027-12-21', '2027-12-31', '2028-01-10'))
    expect(bornes(periodeDe('2027-02-21', 'decade'))).toEqual(ATTENDUE('2027-02-21', '2027-02-28', '2027-03-10'))
    expect(bornes(periodeDe('2028-02-29', 'decade'))).toEqual(ATTENDUE('2028-02-21', '2028-02-29', '2028-03-10'))
  })

  it('se nomme par ses jours', () => {
    expect(periodeDe('2027-09-05', 'decade')).toMatchObject({ libelle: 'du 1er au 10 septembre 2027', libelleDe: 'du 1er au 10 septembre 2027' })
    expect(periodeDe('2027-09-15', 'decade')?.libelle).toBe('du 11 au 20 septembre 2027')
    expect(periodeDe('2027-09-25', 'decade')?.libelle).toBe('du 21 au 30 septembre 2027')
    expect(periodeDe('2027-10-25', 'decade')?.libelle).toBe('du 21 au 31 octobre 2027')
    expect(periodeDe('2027-02-25', 'decade')?.libelle).toBe('du 21 au 28 février 2027')
  })
})

describe('periodeDe — le mois', () => {
  it('le mois civil, à déposer le 10 du mois suivant', () => {
    // [M] §60 et §90 (réel normal trimestriel) ; [P] §170 et §190 (paiements au réel) ; [T13] « Le 10 du mois suivant la
    // période concernée » ; [FICHE] « Avant le 10 du mois suivant ».
    expect(bornes(periodeDe('2027-09-17', 'mois'))).toEqual(ATTENDUE('2027-09-01', '2027-09-30', '2027-10-10'))
    expect(bornes(periodeDe('2027-12-31', 'mois'))).toEqual(ATTENDUE('2027-12-01', '2027-12-31', '2028-01-10'))
    expect(bornes(periodeDe('2028-02-01', 'mois'))).toEqual(ATTENDUE('2028-02-01', '2028-02-29', '2028-03-10'))
    expect(periodeDe('2027-09-17', 'mois')?.prudence).toBeNull()
  })

  it('se nomme avec sa préposition', () => {
    expect(periodeDe('2027-09-17', 'mois')).toMatchObject({ libelle: 'septembre 2027', libelleDe: 'de septembre 2027' })
    expect(periodeDe('2027-10-01', 'mois')?.libelleDe).toBe('d’octobre 2027')
    expect(periodeDe('2028-04-30', 'mois')?.libelleDe).toBe('d’avril 2028')
    expect(periodeDe('2028-08-15', 'mois')?.libelleDe).toBe('d’août 2028')
    expect(periodeDe('2028-01-15', 'mois')?.libelleDe).toBe('de janvier 2028')
  })
})

describe('periodeDe — le bimestre civil de la franchise en base', () => {
  it('les six bimestres d’une année, chacun à déposer le 25 du mois qui le suit', () => {
    // [M] §70, remarque : « janvier et février, mars et avril, mai et juin, juillet et août, septembre et octobre,
    // novembre et décembre » ; [T13] note 126 : ils commencent les 1er janvier, mars, mai, juillet, septembre, novembre.
    // [M] §100 et [P] §210 : « entre le 25 et la fin du mois suivant la fin de la période » — le 25, au plus tôt.
    const attendus: [string, ReturnType<typeof ATTENDUE>][] = [
      ['2028-02-10', ATTENDUE('2028-01-01', '2028-02-29', '2028-03-25')],
      ['2028-03-31', ATTENDUE('2028-03-01', '2028-04-30', '2028-05-25')],
      ['2028-06-01', ATTENDUE('2028-05-01', '2028-06-30', '2028-07-25')],
      ['2028-07-14', ATTENDUE('2028-07-01', '2028-08-31', '2028-09-25')],
      ['2027-09-01', ATTENDUE('2027-09-01', '2027-10-31', '2027-11-25')],
      ['2027-11-30', ATTENDUE('2027-11-01', '2027-12-31', '2028-01-25')],
    ]
    for (const [date, attendu] of attendus) expect(bornes(periodeDe(date, 'bimestre')), date).toEqual(attendu)
    expect(bornes(periodeDe('2027-02-28', 'bimestre'))).toEqual(ATTENDUE('2027-01-01', '2027-02-28', '2027-03-25'))
  })

  it('dit que le 25 est la borne prudente d’une fenêtre propre à l’entreprise, et se nomme par ses deux mois', () => {
    // [FICHE] « Au plus tard entre le 25 et 30 du mois suivant la fin de la période » ; [T13] « Le dernier jour du mois
    // suivant la période concernée ».
    expect(PRUDENCE_FIN_DE_MOIS).toBe('du 25 à la fin du mois selon l’entreprise ; l’application retient le 25')
    expect(periodeDe('2027-10-31', 'bimestre')).toMatchObject({
      prudence: PRUDENCE_FIN_DE_MOIS, libelle: 'septembre et octobre 2027', libelleDe: 'de septembre et octobre 2027',
    })
    expect(periodeDe('2027-12-01', 'bimestre')?.libelle).toBe('novembre et décembre 2027')
  })
})

describe('periodeDe — la forme', () => {
  it('une date qui n’en est pas une n’a pas de période', () => {
    for (const date of ['', '2027-02-29', '2027-02-30', '2027-04-31', '2027-13-01', '2027-00-10', '2027-01-00', '15/10/2027', '2027-1-01']) {
      for (const frequence of ['decade', 'mois', 'bimestre'] as FrequenceEreporting[]) expect(periodeDe(date, frequence), `${date} ${frequence}`).toBeNull()
    }
  })

  // Une propriété, pas un cas : sur deux années entières, chaque jour est dans SA période, qui finit avant son échéance,
  // et la période du lendemain de la fin commence ce lendemain — ni trou ni chevauchement.
  it('chaque jour de 2027 et 2028 est dans une période, et une seule', () => {
    for (const frequence of ['decade', 'mois', 'bimestre'] as FrequenceEreporting[]) {
      let jour = '2027-01-01'
      let periodes = 0
      while (jour <= '2028-12-31') {
        const p = periodeDe(jour, frequence) as PeriodeEreporting
        expect(p.debut <= jour && jour <= p.fin && p.fin < p.echeance, `${frequence} ${jour}`).toBe(true)
        expect(bornes(periodeDe(p.debut, frequence)), `${frequence} ${jour}`).toEqual(bornes(p))
        expect(bornes(periodeDe(p.fin, frequence)), `${frequence} ${jour}`).toEqual(bornes(p))
        periodes++
        jour = ajouterJours(p.fin, 1)
      }
      // 72 décades, 24 mois, 12 bimestres sur deux ans.
      expect(periodes, frequence).toBe({ decade: 72, mois: 24, bimestre: 12 }[frequence])
    }
  })
})

describe('calendrierEreporting — les périodes depuis le 1er septembre 2027', () => {
  it('rien avant le 1er septembre 2027 : aucune période, donc aucun envoi', () => {
    // [D10] §10 : l'obligation commence au 1er septembre 2027 pour une PME.
    for (const frequence of ['decade', 'mois', 'bimestre'] as FrequenceEreporting[]) {
      expect(calendrierEreporting(frequence, '2027-08-31'), frequence).toEqual([])
      expect(calendrierEreporting(frequence, '2026-10-09'), frequence).toEqual([])
    }
  })

  it('le 1er septembre 2027 ouvre une décade, un mois et un bimestre, en cours', () => {
    // [T13] note 126 : un bimestre civil commence le 1er septembre.
    expect(calendrierEreporting('decade', '2027-09-01')?.map((p) => [p.debut, p.fin, p.etat])).toEqual([['2027-09-01', '2027-09-10', 'en_cours']])
    expect(calendrierEreporting('mois', '2027-09-01')?.map((p) => [p.debut, p.fin, p.etat])).toEqual([['2027-09-01', '2027-09-30', 'en_cours']])
    expect(calendrierEreporting('bimestre', '2027-09-01')?.map((p) => [p.debut, p.fin, p.etat])).toEqual([['2027-09-01', '2027-10-31', 'en_cours']])
  })

  it('le dernier jour d’une période, elle est encore en cours ; elle ne se déclare qu’une fois finie', () => {
    // [CONC] §2.2 et §3.4 : une période ne se déclare qu'une fois finie (TT-3, « APRÈS la fin de la période », G7.53).
    expect(calendrierEreporting('mois', '2027-09-30')?.map((p) => [p.libelle, p.etat])).toEqual([['septembre 2027', 'en_cours']])
    expect(calendrierEreporting('mois', '2027-10-01')?.map((p) => [p.libelle, p.etat])).toEqual([
      ['septembre 2027', 'close'], ['octobre 2027', 'en_cours'],
    ])
    expect(calendrierEreporting('decade', '2027-09-10')?.map((p) => p.etat)).toEqual(['en_cours'])
    expect(calendrierEreporting('decade', '2027-09-11')?.map((p) => p.etat)).toEqual(['close', 'en_cours'])
  })

  it('une période close se déclare jusqu’à son échéance comprise ; le lendemain, l’échéance est passée', () => {
    // [M] §100 : septembre-octobre 2027 se dépose au plus tard le 25 novembre (borne prudente).
    expect(calendrierEreporting('bimestre', '2027-11-25')?.map((p) => p.etat)).toEqual(['close', 'en_cours'])
    expect(calendrierEreporting('bimestre', '2027-11-26')?.map((p) => p.etat)).toEqual(['echeance_passee', 'en_cours'])
    // [M] §90 : la troisième décade de septembre se dépose au plus tard le 10 octobre.
    expect(calendrierEreporting('decade', '2027-10-05')?.map((p) => [p.libelle, p.etat])).toEqual([
      ['du 1er au 10 septembre 2027', 'echeance_passee'],
      ['du 11 au 20 septembre 2027', 'echeance_passee'],
      ['du 21 au 30 septembre 2027', 'close'],
      ['du 1er au 10 octobre 2027', 'en_cours'],
    ])
  })

  it('compte ses périodes, dans l’ordre, jusqu’à celle d’aujourd’hui — chacune une fois', () => {
    const mois = calendrierEreporting('mois', '2028-09-01') as PeriodeEreporting[]
    expect(mois).toHaveLength(13)
    expect([mois[0].debut, mois[12].debut]).toEqual(['2027-09-01', '2028-09-01'])
    expect(calendrierEreporting('decade', '2027-12-31')).toHaveLength(12)
    // Six bimestres par an : de septembre-octobre 2027 à juillet-août 2028, puis septembre-octobre 2028.
    expect(calendrierEreporting('bimestre', '2028-09-01')?.map((p) => p.libelle)).toEqual([
      'septembre et octobre 2027', 'novembre et décembre 2027', 'janvier et février 2028', 'mars et avril 2028',
      'mai et juin 2028', 'juillet et août 2028', 'septembre et octobre 2028',
    ])
    // Chaque période suit la précédente sans trou ni recouvrement.
    for (const frequence of ['decade', 'mois', 'bimestre'] as FrequenceEreporting[]) {
      const periodes = calendrierEreporting(frequence, '2029-03-15') as PeriodeEreporting[]
      for (let i = 1; i < periodes.length; i++) expect(periodes[i].debut, `${frequence} ${i}`).toBe(ajouterJours(periodes[i - 1].fin, 1))
    }
  })

  it('sur dix ans, rend la main : le calendrier avance d’un mois par tour, quoi que rendent les périodes', () => {
    expect(calendrierEreporting('decade', '2037-08-31')).toHaveLength(360)
    expect(calendrierEreporting('bimestre', '2037-08-31')).toHaveLength(60)
  })

  it('un jour qui n’en est pas un ne donne pas de calendrier', () => {
    expect(calendrierEreporting('mois', '2027-02-30')).toBeNull()
    expect(calendrierEreporting('mois', '')).toBeNull()
  })
})

describe('le calendrier civil, sous les quatre fuseaux de test:fuseaux', () => {
  const FUSEAU_D_ORIGINE = process.env.TZ
  afterEach(() => {
    process.env.TZ = FUSEAU_D_ORIGINE
  })

  // Le test choisit ses fuseaux : sous Europe/Paris seul, une période calculée par `new Date` passerait.
  it('rend les mêmes périodes et les mêmes échéances partout', () => {
    process.env.TZ = 'America/New_York'
    expect(new Date('2027-09-01').getDate()).toBe(31)
    const dates = ['2027-01-01', '2027-02-20', '2027-02-21', '2027-09-01', '2027-10-31', '2027-12-31', '2028-02-29']
    const reference: unknown[] = []
    for (const fuseau of ['Europe/Paris', 'UTC', 'America/New_York', 'Pacific/Auckland']) {
      process.env.TZ = fuseau
      const rendus = dates.flatMap((d) => (['decade', 'mois', 'bimestre'] as FrequenceEreporting[]).map((f) => periodeDe(d, f)))
      rendus.push(...(calendrierEreporting('decade', '2027-10-05') ?? []))
      if (reference.length === 0) reference.push(...rendus)
      else expect(rendus, fuseau).toEqual(reference)
    }
    // [M] §90, [T13] et [M] §100 : trois échéances relues à la main, sous le dernier fuseau.
    expect(periodeDe('2027-12-31', 'decade')?.echeance).toBe('2028-01-10')
    expect(periodeDe('2027-02-20', 'decade')?.echeance).toBe('2027-02-28')
    expect(periodeDe('2027-12-31', 'bimestre')?.echeance).toBe('2028-01-25')
  })
})
