import { describe, expect, it } from 'vitest'
import {
  autreSensReconnu, ignoresParLaRegle, ignoresParLaRegleSelon, phraseDesIgnores, phraseDesIgnoresSelon, regleOperante,
  statutPourMouvement, statutPourMouvementSelon,
} from './reglesIgnorees'
import { AUCUN_HORS_DES_LOTS } from './mouvementsDesVentes'
import { SENS_DES_REGLES_IGNOREES_EXPORTE } from './sensDesReglesIgnorees'
import type { LigneBancaire } from './types'

// LA RÈGLE « TOUJOURS IGNORER » (relecture du 31/10/2026) : elle cherchait le motif en SOUS-CHAÎNE, sans rien en refuser.
// Elle se juge désormais comme les règles d'affectation — forme normalisée, début de mot, `refusMotif` —, une règle dont
// le motif ne désigne pas un tiers est inopérante, et l'import dit ce que chaque règle a fait.
//
// LE SENS (REGLES-Q1 ; la migration `sens_des_regles_ignorees`, préparée) : le drapeau se joue ici dans ses DEUX états,
// écrits (`…Selon(false, …)`, `…Selon(true, …)`) — baissé, l'état d'aujourd'hui, au caractère près, quel que soit le
// drapeau du module, que la migration lèvera ; levé, une règle ne fait ignorer que les mouvements de son sens.

const mvt = (id: string, libelle: string, montant: number): Pick<LigneBancaire, 'id' | 'statut' | 'libelle' | 'montant'> =>
  ({ id, statut: 'non_rapprochee', libelle, montant })
const debit = (libelle: string) => ({ libelle, montant: -40 })
const credit = (libelle: string) => ({ libelle, montant: 120 })

describe('statutPourMouvement — le motif, dans les deux états du drapeau', () => {
  for (const parSens of [false, true]) {
    const statut = (libelle: string, regles: { motif: string }[]) => statutPourMouvementSelon(parSens, debit(libelle), regles)

    it(`${parSens ? 'levé' : 'baissé'} : ignore un libellé dont un mot commence par le motif, sous la forme normalisée`, () => {
      expect(statut('PRLV SEPA MACSF ECH/150625', [{ motif: 'macsf' }])).toBe('ignoree')
      expect(statut('PRLV SEPA SWISSLIFE PREVOYAN', [{ motif: 'swisslife prevoyance' }])).toBe('non_rapprochee')
      expect(statut('PRLV SEPA SWISSLIFE PREVOYAN', [{ motif: 'swisslife prev' }])).toBe('ignoree')
      // Accents et sigles pointés ramenés à la forme du motif, comme pour les règles d'affectation.
      expect(statut('PRLV M.A.C.S.F. Échéance', [{ motif: 'macsf' }])).toBe('ignoree')
      // Une règle d'avant, enregistrée en minuscules avec sa ponctuation, reconnaît toujours son libellé.
      expect(statut('PRLV SEPA MACSF ECH/150625', [{ motif: 'prlv sepa macsf ech/150625' }])).toBe('ignoree')
    })

    it(`${parSens ? 'levé' : 'baissé'} : ne trouve pas le motif au milieu d’un mot`, () => {
      expect(statut('VIR MEDFORMATION SEMINAIRE', [{ motif: 'edf' }])).toBe('non_rapprochee')
      expect(statut('PRLV EDF ENTREPRISES', [{ motif: 'edf' }])).toBe('ignoree')
    })

    it(`${parSens ? 'levé' : 'baissé'} : une règle dont le motif ne désigne pas un tiers est inopérante`, () => {
      for (const motif of ['prlv', 'prlv sepa', 'vir', 'carte', '1234']) {
        expect(regleOperante({ motif })).toBe(false)
        expect(statut(`${motif.toUpperCase()} URSSAF 1234`, [{ motif }])).toBe('non_rapprochee')
      }
      expect(regleOperante({ motif: 'urssaf' })).toBe(true)
      // Une inopérante ne fait pas taire une opérante voisine.
      expect(statut('PRLV SEPA URSSAF', [{ motif: 'prlv' }, { motif: 'urssaf' }])).toBe('ignoree')
    })
  }

  it('le jugement de la règle nouvelle sur les mouvements déjà importés est le même', () => {
    const lignes = [mvt('a', 'PRLV SEPA URSSAF', -100), mvt('b', 'VIR MEDFORMATION', 50)]
    for (const parSens of [false, true]) {
      expect(ignoresParLaRegleSelon(parSens, lignes, { motif: 'prlv' }, AUCUN_HORS_DES_LOTS).aIgnorer).toEqual([])
      expect(ignoresParLaRegleSelon(parSens, lignes, { motif: 'edf' }, AUCUN_HORS_DES_LOTS).aIgnorer).toEqual([])
      expect(ignoresParLaRegleSelon(parSens, lignes, { motif: 'urssaf' }, AUCUN_HORS_DES_LOTS).aIgnorer.map((l) => l.id)).toEqual(['a'])
    }
  })
})

describe('le sens retenu par la règle (REGLES-Q1)', () => {
  const nee = (sens: 'encaissement' | 'decaissement' | null) => [{ motif: 'cpam', sens }]

  it('levé : née d’un débit, elle n’ignore que les débits ; née d’un crédit, que les crédits', () => {
    expect(statutPourMouvementSelon(true, debit('PRLV CPAM PARTICIPATION'), nee('decaissement'))).toBe('ignoree')
    expect(statutPourMouvementSelon(true, credit('VIR CPAM DES YVELINES 0325'), nee('decaissement'))).toBe('non_rapprochee')
    expect(statutPourMouvementSelon(true, credit('VIR CPAM DES YVELINES 0325'), nee('encaissement'))).toBe('ignoree')
    expect(statutPourMouvementSelon(true, debit('PRLV CPAM PARTICIPATION'), nee('encaissement'))).toBe('non_rapprochee')
  })

  it('levé : une règle d’avant — nulle, ou que la base ne rend pas encore — vaut pour les deux sens, comme hier', () => {
    for (const regles of [nee(null), [{ motif: 'cpam' }]]) {
      expect(statutPourMouvementSelon(true, debit('PRLV CPAM PARTICIPATION'), regles)).toBe('ignoree')
      expect(statutPourMouvementSelon(true, credit('VIR CPAM DES YVELINES 0325'), regles)).toBe('ignoree')
    }
    // Deux règles du même motif : chacune pour son sens, et le mouvement ignoré dès qu'une le prend.
    const deux = [{ motif: 'cpam', sens: 'decaissement' as const }, { motif: 'cpam', sens: 'encaissement' as const }]
    expect(statutPourMouvementSelon(true, credit('VIR CPAM'), deux)).toBe('ignoree')
    expect(statutPourMouvementSelon(true, debit('PRLV CPAM'), deux)).toBe('ignoree')
  })

  it('levé : un mouvement de zéro euro, sans sens, n’est reconnu que par une règle des deux sens', () => {
    expect(statutPourMouvementSelon(true, { libelle: 'CPAM REGUL', montant: 0 }, nee('decaissement'))).toBe('non_rapprochee')
    expect(statutPourMouvementSelon(true, { libelle: 'CPAM REGUL', montant: 0 }, nee(null))).toBe('ignoree')
  })

  it('baissé : le sens lu ne compte pas — chaque règle vaut pour les deux sens, le jugement d’hier', () => {
    for (const sens of ['decaissement', 'encaissement', null] as const) {
      expect(statutPourMouvementSelon(false, debit('PRLV CPAM PARTICIPATION'), nee(sens))).toBe('ignoree')
      expect(statutPourMouvementSelon(false, credit('VIR CPAM DES YVELINES 0325'), nee(sens))).toBe('ignoree')
      expect(statutPourMouvementSelon(false, { libelle: 'CPAM REGUL', montant: 0 }, nee(sens))).toBe('ignoree')
    }
  })

  it('la fonction sans suffixe suit le drapeau du module', () => {
    expect(statutPourMouvement(credit('VIR CPAM DES YVELINES 0325'), nee('decaissement')))
      .toBe(SENS_DES_REGLES_IGNOREES_EXPORTE ? 'non_rapprochee' : 'ignoree')
    const lignes = [mvt('d', 'PRLV CPAM PARTICIPATION', -2), mvt('c', 'VIR CPAM DES YVELINES', 120)]
    expect(ignoresParLaRegle(lignes, { motif: 'cpam', sens: 'decaissement' }, AUCUN_HORS_DES_LOTS).aIgnorer.map((l) => l.id))
      .toEqual(SENS_DES_REGLES_IGNOREES_EXPORTE ? ['d'] : ['d', 'c'])
    expect(phraseDesIgnores([credit('VIR CPAM')], nee('decaissement')))
      .toBe(phraseDesIgnoresSelon(SENS_DES_REGLES_IGNOREES_EXPORTE, [credit('VIR CPAM')], nee('decaissement')))
  })

  it('sur les mouvements déjà importés, levé : la règle née d’un débit ne prend pas un crédit ; baissé, si', () => {
    const lignes = [mvt('d', 'PRLV CPAM PARTICIPATION', -2), mvt('c', 'VIR CPAM DES YVELINES', 120), mvt('z', 'CPAM REGUL', 0)]
    expect(ignoresParLaRegleSelon(true, lignes, { motif: 'cpam', sens: 'decaissement' }, AUCUN_HORS_DES_LOTS).aIgnorer.map((l) => l.id)).toEqual(['d'])
    expect(ignoresParLaRegleSelon(true, lignes, { motif: 'cpam', sens: 'encaissement' }, AUCUN_HORS_DES_LOTS).aIgnorer.map((l) => l.id)).toEqual(['c'])
    expect(ignoresParLaRegleSelon(false, lignes, { motif: 'cpam', sens: 'decaissement' }, AUCUN_HORS_DES_LOTS).aIgnorer.map((l) => l.id)).toEqual(['d', 'c', 'z'])
  })
})

describe('phraseDesIgnores — ce que l’alerte d’import dit des règles', () => {
  it('rien à dire quand aucune règle ne reconnaît rien, dans les deux états', () => {
    for (const parSens of [false, true]) {
      expect(phraseDesIgnoresSelon(parSens, [mvt('a', 'PRLV EDF', -40)], [{ motif: 'macsf' }])).toBe('')
      expect(phraseDesIgnoresSelon(parSens, [mvt('a', 'PRLV EDF', -40)], [])).toBe('')
      // Levé, une règle des encaissements ne dit rien d'un paiement qu'elle reconnaîtrait.
      expect(phraseDesIgnoresSelon(parSens, [mvt('a', 'PRLV EDF', -40)], [{ motif: 'edf', sens: 'encaissement' }]))
        .toBe(parSens ? '' : '\n\n1 mouvement ignoré par une règle « toujours ignorer » : « edf » 1.')
    }
  })

  // Baissé — l'alerte d'aujourd'hui, au caractère près.
  it('baissé : compte, règle par règle, les mouvements ignorés et les encaissements parmi eux', () => {
    const mouvements = [
      mvt('a', 'PRLV SEPA MACSF', -40), mvt('b', 'PRLV SEPA MACSF', -40), mvt('c', 'VIR CPAM YVELINES', 120),
      mvt('d', 'PRLV CPAM PARTICIPATION', -2), mvt('e', 'PRLV EDF', -60),
    ]
    const attendu = '\n\n4 mouvements ignorés par une règle « toujours ignorer » : « cpam » 2 (dont 1 encaissement), « macsf » 2.'
      + ' Une règle ne retient pas encore le sens du mouvement : vérifie qu’aucun encaissement ignoré n’est une recette — ignoré, il sort des recettes.'
    expect(phraseDesIgnoresSelon(false, mouvements, [{ motif: 'cpam' }, { motif: 'macsf' }])).toBe(attendu)
    // Le sens lu ne change rien, baissé.
    expect(phraseDesIgnoresSelon(false, mouvements, [{ motif: 'cpam', sens: 'decaissement' }, { motif: 'macsf', sens: 'decaissement' }])).toBe(attendu)
  })

  it('baissé : sans encaissement ignoré, pas d’avertissement sur le sens', () => {
    expect(phraseDesIgnoresSelon(false, [mvt('a', 'PRLV SEPA MACSF', -40)], [{ motif: 'macsf' }]))
      .toBe('\n\n1 mouvement ignoré par une règle « toujours ignorer » : « macsf » 1.')
  })

  it('baissé : dit la règle inopérante et ce qu’elle laisse à traiter', () => {
    expect(phraseDesIgnoresSelon(false, [mvt('a', 'PRLV SEPA URSSAF', -100), mvt('b', 'PRLV EDF', -60), mvt('c', 'VIR CPAM', 20)], [{ motif: 'prlv' }]))
      .toBe('\n\nLa règle « prlv » ne fait plus rien ignorer : son motif désigne un type d’opération, pas un tiers. '
        + '2 mouvements qu’elle reconnaît restent à traiter ; retire-la, ou remplace-la par un mot qui nomme le tiers.')
    // Un mouvement qu'une règle opérante ignore n'est pas « laissé à traiter » par l'inopérante.
    expect(phraseDesIgnoresSelon(false, [mvt('a', 'PRLV SEPA URSSAF', -100)], [{ motif: 'prlv' }, { motif: 'urssaf' }]))
      .toBe('\n\n1 mouvement ignoré par une règle « toujours ignorer » : « urssaf » 1.')
  })

  // Levé — chaque règle sous son sens.
  it('levé : chaque règle nommée avec son sens ; seule une règle des deux sens dit ses encaissements, et l’avertissement', () => {
    const mouvements = [
      mvt('a', 'PRLV SEPA MACSF', -40), mvt('c', 'VIR CPAM YVELINES', 120), mvt('d', 'PRLV CPAM PARTICIPATION', -2),
      mvt('f', 'VIR DUPONT HONORAIRES', 60), mvt('g', 'PRLV DUPONT LOYER', -500),
    ]
    const regles = [
      { motif: 'cpam', sens: 'decaissement' as const }, { motif: 'dupont', sens: null }, { motif: 'macsf', sens: 'decaissement' as const },
    ]
    expect(phraseDesIgnoresSelon(true, mouvements, regles)).toBe(
      '\n\n4 mouvements ignorés par une règle « toujours ignorer » : « cpam » (paiements) 1, « dupont » (les deux sens) 2 (dont 1 encaissement), '
      + '« macsf » (paiements) 1.'
      + ' Une règle des deux sens fait ignorer aussi les encaissements : vérifie qu’aucun encaissement ignoré n’est une recette — ignoré, il sort des recettes. '
      + 'Pour qu’elle ne vise que les paiements, recrée-la depuis un paiement, puis retire-la.')
  })

  it('levé : une règle des encaissements en compte sans avertir — elle est née d’un crédit', () => {
    expect(phraseDesIgnoresSelon(true, [mvt('c', 'VIR EPARGNE ALPHA', 300), mvt('d', 'PRLV EPARGNE ALPHA', -300)], [{ motif: 'epargne alpha', sens: 'encaissement' }]))
      .toBe('\n\n1 mouvement ignoré par une règle « toujours ignorer » : « epargne alpha » (encaissements) 1.')
  })

  it('levé : la règle inopérante se nomme avec son sens, et ne compte que les mouvements de son sens', () => {
    expect(phraseDesIgnoresSelon(true, [mvt('a', 'PRLV SEPA URSSAF', -100), mvt('c', 'PRLV REMBOURSEMENT', 20)], [{ motif: 'prlv', sens: 'decaissement' }]))
      .toBe('\n\nLa règle « prlv » (paiements) ne fait plus rien ignorer : son motif désigne un type d’opération, pas un tiers. '
        + '1 mouvement qu’elle reconnaît reste à traiter ; retire-la, ou remplace-la par un mot qui nomme le tiers.')
  })
})

describe('autreSensReconnu — ce qu’une règle née d’un mouvement ferait ignorer de l’autre sens', () => {
  const releve = [
    mvt('origine', 'PRLV CPAM PARTICIPATION', -2), mvt('recette', 'VIR CPAM DES YVELINES 0325', 120),
    mvt('autre-debit', 'PRLV CPAM FRANCHISE', -1), mvt('zero', 'CPAM REGUL', 0), mvt('ailleurs', 'VIR M DUPONT', 60),
  ]
  it('nomme les crédits qu’une règle née d’un débit reconnaît, et rien d’autre', () => {
    expect(autreSensReconnu(releve[0], 'cpam', releve).map((l) => l.id)).toEqual(['recette'])
    expect(autreSensReconnu(releve[1], 'cpam', releve).map((l) => l.id)).toEqual(['origine', 'autre-debit'])
    expect(autreSensReconnu(releve[0], 'participation', releve)).toEqual([])
  })
})
