import { describe, expect, it } from 'vitest'
import { autreSensReconnu, ignoresParLaRegle, phraseDesIgnores, regleOperante, statutPourLibelle } from './reglesIgnorees'
import { AUCUN_HORS_DES_LOTS } from './mouvementsDesVentes'
import type { LigneBancaire } from './types'

// LA RÈGLE « TOUJOURS IGNORER » (relecture du 31/10/2026) : elle cherchait le motif en SOUS-CHAÎNE, sans rien en refuser.
// Elle se juge désormais comme les règles d'affectation — forme normalisée, début de mot, `refusMotif` —, une règle dont
// le motif ne désigne pas un tiers est inopérante, et l'import dit ce que chaque règle a fait.

const mvt = (id: string, libelle: string, montant: number): Pick<LigneBancaire, 'id' | 'statut' | 'libelle' | 'montant'> =>
  ({ id, statut: 'non_rapprochee', libelle, montant })

describe('statutPourLibelle', () => {
  it('ignore un libellé dont un mot commence par le motif, sous la forme normalisée', () => {
    expect(statutPourLibelle('PRLV SEPA MACSF ECH/150625', [{ motif: 'macsf' }])).toBe('ignoree')
    expect(statutPourLibelle('PRLV SEPA SWISSLIFE PREVOYAN', [{ motif: 'swisslife prevoyance' }])).toBe('non_rapprochee')
    expect(statutPourLibelle('PRLV SEPA SWISSLIFE PREVOYAN', [{ motif: 'swisslife prev' }])).toBe('ignoree')
    // Accents et sigles pointés ramenés à la forme du motif, comme pour les règles d'affectation.
    expect(statutPourLibelle('PRLV M.A.C.S.F. Échéance', [{ motif: 'macsf' }])).toBe('ignoree')
    // Une règle d'avant, enregistrée en minuscules avec sa ponctuation, reconnaît toujours son libellé.
    expect(statutPourLibelle('PRLV SEPA MACSF ECH/150625', [{ motif: 'prlv sepa macsf ech/150625' }])).toBe('ignoree')
  })

  it('ne trouve pas le motif au milieu d’un mot', () => {
    expect(statutPourLibelle('VIR MEDFORMATION SEMINAIRE', [{ motif: 'edf' }])).toBe('non_rapprochee')
    expect(statutPourLibelle('PRLV EDF ENTREPRISES', [{ motif: 'edf' }])).toBe('ignoree')
  })

  it('une règle dont le motif ne désigne pas un tiers est inopérante', () => {
    for (const motif of ['prlv', 'prlv sepa', 'vir', 'carte', '1234']) {
      expect(regleOperante({ motif })).toBe(false)
      expect(statutPourLibelle(`${motif.toUpperCase()} URSSAF 1234`, [{ motif }])).toBe('non_rapprochee')
    }
    expect(regleOperante({ motif: 'urssaf' })).toBe(true)
    // Une inopérante ne fait pas taire une opérante voisine.
    expect(statutPourLibelle('PRLV SEPA URSSAF', [{ motif: 'prlv' }, { motif: 'urssaf' }])).toBe('ignoree')
  })

  it('le jugement de la règle nouvelle sur les mouvements déjà importés est le même', () => {
    const lignes = [mvt('a', 'PRLV SEPA URSSAF', -100), mvt('b', 'VIR MEDFORMATION', 50)]
    expect(ignoresParLaRegle(lignes, 'prlv', AUCUN_HORS_DES_LOTS).aIgnorer).toEqual([])
    expect(ignoresParLaRegle(lignes, 'edf', AUCUN_HORS_DES_LOTS).aIgnorer).toEqual([])
    expect(ignoresParLaRegle(lignes, 'urssaf', AUCUN_HORS_DES_LOTS).aIgnorer.map((l) => l.id)).toEqual(['a'])
  })
})

describe('phraseDesIgnores — ce que l’alerte d’import dit des règles', () => {
  it('rien à dire quand aucune règle ne reconnaît rien', () => {
    expect(phraseDesIgnores([mvt('a', 'PRLV EDF', -40)], [{ motif: 'macsf' }])).toBe('')
    expect(phraseDesIgnores([mvt('a', 'PRLV EDF', -40)], [])).toBe('')
  })

  it('compte, règle par règle, les mouvements ignorés et les encaissements parmi eux', () => {
    const phrase = phraseDesIgnores([
      mvt('a', 'PRLV SEPA MACSF', -40), mvt('b', 'PRLV SEPA MACSF', -40), mvt('c', 'VIR CPAM YVELINES', 120),
      mvt('d', 'PRLV CPAM PARTICIPATION', -2), mvt('e', 'PRLV EDF', -60),
    ], [{ motif: 'cpam' }, { motif: 'macsf' }])
    expect(phrase).toBe('\n\n4 mouvements ignorés par une règle « toujours ignorer » : « cpam » 2 (dont 1 encaissement), « macsf » 2.'
      + ' Une règle ne retient pas encore le sens du mouvement : vérifie qu’aucun encaissement ignoré n’est une recette — ignoré, il sort des recettes.')
  })

  it('sans encaissement ignoré, pas d’avertissement sur le sens', () => {
    expect(phraseDesIgnores([mvt('a', 'PRLV SEPA MACSF', -40)], [{ motif: 'macsf' }]))
      .toBe('\n\n1 mouvement ignoré par une règle « toujours ignorer » : « macsf » 1.')
  })

  it('dit la règle inopérante et ce qu’elle laisse à traiter', () => {
    expect(phraseDesIgnores([mvt('a', 'PRLV SEPA URSSAF', -100), mvt('b', 'PRLV EDF', -60), mvt('c', 'VIR CPAM', 20)], [{ motif: 'prlv' }]))
      .toBe('\n\nLa règle « prlv » ne fait plus rien ignorer : son motif désigne un type d’opération, pas un tiers. '
        + '2 mouvements qu’elle reconnaît restent à traiter ; retire-la, ou remplace-la par un mot qui nomme le tiers.')
    // Un mouvement qu'une règle opérante ignore n'est pas « laissé à traiter » par l'inopérante.
    expect(phraseDesIgnores([mvt('a', 'PRLV SEPA URSSAF', -100)], [{ motif: 'prlv' }, { motif: 'urssaf' }]))
      .toBe('\n\n1 mouvement ignoré par une règle « toujours ignorer » : « urssaf » 1.')
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
