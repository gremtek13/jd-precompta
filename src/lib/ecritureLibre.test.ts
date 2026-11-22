import { describe, expect, it } from 'vitest'
import {
  avertissementsDeLEcritureLibre, composerEcrituresLibres, ecartDeclare, ECRITURES_LIBRES_PREVUES, ecritureLibrePourLaBase,
  estRattachee, estRattacheeComptee, MOTS_DES_REFUS, posteDeLaClasse, posteProposeDuCompte, propositionDeLaRegle,
  refusDeLEcritureLibre, TABLES_DES_ECRITURES_LIBRES,
  type ContexteDEcritureLibre, type LigneDEcritureLibre, type SaisieDEcritureLibre,
} from './ecritureLibre'
import { migrationRangee } from '../test/schema'

// EL1 : LE JUGEMENT D'UNE ÉCRITURE LIBRE AVANT LE CLIC (conception 54, § 3). Les refus, leur ordre et leurs codes ; les
// avertissements, qui ne refusent rien ; la règle de la trésorerie devant une charge rattachée (EL-Q3 (A), sans la désignation
// « contre la règle » que retire EXP58-Q3 (A)) ; la composition que
// la base recompose. La confrontation au texte de la migration : ecritureLibreEnBase.test.ts.

const ligne = (compte: string, sens: 'debit' | 'credit', centimes: number, poste2035: string | null = null,
  compteLib: string | null = null): LigneDEcritureLibre => ({ compte, sens, centimes, poste2035, compteLib })

const saisie = (s: Partial<SaisieDEcritureLibre> = {}): SaisieDEcritureLibre => ({
  date: '2025-06-30', libelle: 'Reclassement des fournitures', motif: 'Une facture de fournitures rangée en petit outillage.',
  lignes: [ligne('606400', 'debit', 12000, 'Fournitures de bureau'), ligne('606300', 'credit', 12000, 'Petit outillage')],
  avecExtourne: false, ...s,
})

const tresorerie: ContexteDEcritureLibre = { mode: 'tresorerie', frontiere: '2024-12-31', ouverture: '2024-01-01', aujourdhui: '2025-11-17' }
const engagement: ContexteDEcritureLibre = { ...tresorerie, mode: 'engagement' }
const cles = (s: SaisieDEcritureLibre, c: ContexteDEcritureLibre = tresorerie) => refusDeLEcritureLibre(s, c).map((r) => r.cle)

describe('le drapeau et la table', () => {
  it('le drapeau suit la migration : levé si et seulement si elle est rangée dans l’export ; une table', () => {
    expect(ECRITURES_LIBRES_PREVUES).toBe(migrationRangee('ecritures_libres'))
    expect(TABLES_DES_ECRITURES_LIBRES).toEqual(['ecritures_libres'])
  })
})

describe('les refus', () => {
  it('un reclassement entre deux charges, chacune sous son poste, passe ; la même saisie en engagement, sans postes, aussi', () => {
    expect(cles(saisie())).toEqual([])
    const sansPostes = saisie({ lignes: [ligne('606400', 'debit', 12000), ligne('606300', 'credit', 12000)] })
    expect(cles(sansPostes, engagement)).toEqual([])
    expect(cles(sansPostes)).toEqual([])
  })

  it('la date : illisible, figée (23514), avant l’ouverture, après le 31 décembre de l’année en cours', () => {
    expect(cles(saisie({ date: '2025-02-30' }))).toEqual(['dateIllisible'])
    expect(cles(saisie({ date: '30/06/2025' }))).toEqual(['dateIllisible'])
    expect(cles(saisie({ date: '1999-12-31' }))).toEqual(['dateIllisible'])
    const figee = refusDeLEcritureLibre(saisie({ date: '2024-12-31' }), tresorerie)
    expect(figee.map((r) => [r.cle, r.code])).toEqual([['dateFigee', '23514']])
    expect(cles(saisie({ date: '2025-03-01' }), { ...tresorerie, frontiere: null, ouverture: '2025-03-02' })).toEqual(['avantLOuverture'])
    expect(cles(saisie({ date: '2025-12-31' }))).toEqual([])
    expect(cles(saisie({ date: '2026-01-01' }))).toEqual(['dateAVenir'])
  })

  it('l’extourne : au 1er janvier qui suit une écriture du 31 décembre seulement', () => {
    expect(cles(saisie({ avecExtourne: true }))).toEqual(['extourneHorsDuTrenteEtUn'])
    expect(cles(saisie({ date: '2025-12-31', avecExtourne: true }))).toEqual([])
  })

  it('le libellé (une ligne, 200 points de code, pas un caractère de contrôle) et le motif (2 000)', () => {
    expect(cles(saisie({ libelle: '   ' }))).toEqual(['libelle'])
    expect(cles(saisie({ libelle: 'Deux\nlignes' }))).toEqual(['libelle'])
    expect(cles(saisie({ libelle: `Avec une tabulation\t` }))).toEqual([])
    expect(cles(saisie({ libelle: 'Une\ttabulation' }))).toEqual(['libelle'])
    expect(cles(saisie({ libelle: 'x'.repeat(201) }))).toEqual(['libelle'])
    // Un émoji est UN caractère pour la base (`char_length`) : deux cents passent, comme en base.
    expect(cles(saisie({ libelle: '🙂'.repeat(200) }))).toEqual([])
    expect(cles(saisie({ motif: '' }))).toEqual(['motif'])
    expect(cles(saisie({ motif: 'm'.repeat(2001) }))).toEqual(['motif'])
    expect(cles(saisie({ motif: 'Sur deux\nlignes, c’est permis.' }))).toEqual([])
  })

  it('les comptes : la forme, la banque, la caisse et le résultat refusés (EL-Q4 (A)) ; la classe 8 et cinq chiffres aussi', () => {
    const avec = (compte: string) => cles(saisie({ lignes: [ligne(compte, 'debit', 100), ligne('606300', 'credit', 100)] }))
    expect(avec('512000')).toEqual(['banque'])
    expect(avec('512100')).toEqual(['banque'])
    expect(avec('530000')).toEqual(['caisse'])
    expect(avec('120000')).toEqual(['resultat'])
    expect(avec('129000')).toEqual(['resultat'])
    expect(avec('801000')).toEqual(['compte'])
    expect(avec('60640')).toEqual(['compte'])
    // Permis : l'exploitant, le dirigeant, les comptes de tiers, une immobilisation, le 511 et le 518 (pas la banque).
    for (const c of ['108000', '101000', '467000', '468000', '401000', '218300', '511000', '518000']) expect(avec(c), c).toEqual([])
  })

  it('le sens et le montant : un entier de centimes positif', () => {
    const s = saisie()
    expect(cles({ ...s, lignes: [{ ...s.lignes[0], centimes: 0 }, s.lignes[1]] })).toEqual(['montant'])
    expect(cles({ ...s, lignes: [{ ...s.lignes[0], centimes: 12.5 }, s.lignes[1]] })).toEqual(['montant'])
    expect(cles({ ...s, lignes: [{ ...s.lignes[0], sens: 'debit ' as 'debit' }, s.lignes[1]] })).toEqual(['sens', 'desequilibre'])
  })

  it('le poste : aucun en engagement, aucun sur une ligne de bilan, un poste de la liste de sa classe (EL-Q2 (A))', () => {
    expect(cles(saisie(), engagement)).toEqual(['posteEnEngagement', 'posteEnEngagement'])
    expect(cles(saisie({ lignes: [ligne('606400', 'debit', 100, 'Achats'), ligne('108000', 'credit', 100, 'Achats')] })))
      .toEqual(['posteHorsDuResultat'])
    expect(cles(saisie({ lignes: [ligne('706000', 'debit', 100, 'Achats'), ligne('606400', 'credit', 100, 'Recettes')] })))
      .toEqual(['posteInconnu', 'posteInconnu'])
    expect(posteDeLaClasse('706000', 'Recettes')).toBe(true)
    expect(posteDeLaClasse('606000', 'Recettes')).toBe(false)
    expect(posteDeLaClasse('408000', 'Achats')).toBe(false)
  })

  it('un compte, un libellé ; le libellé d’un compte sur une ligne', () => {
    expect(cles(saisie({ lignes: [ligne('471100', 'debit', 100, null, 'Attente A'), ligne('471100', 'credit', 50, null, 'Attente B'),
      ligne('606300', 'credit', 50, 'Petit outillage')] }))).toEqual(['deuxLibelles'])
    expect(cles(saisie({ lignes: [ligne('471100', 'debit', 100, null, 'Attente'), ligne('471100', 'credit', 100)] })))
      .toEqual(['deuxLibelles'])
    expect(cles(saisie({ lignes: [ligne('471100', 'debit', 100, null, 'Att\nente'), ligne('606300', 'credit', 100, 'Petit outillage')] })))
      .toEqual(['libelleDuCompte'])
  })

  it('le nombre de lignes et l’équilibre au centime', () => {
    expect(cles(saisie({ lignes: [ligne('606400', 'debit', 100, 'Achats')] }))).toEqual(['nombreDeLignes', 'desequilibre'])
    expect(cles(saisie({ lignes: [ligne('606400', 'debit', 100, 'Achats'), ligne('606300', 'credit', 99, 'Achats')] })))
      .toEqual(['desequilibre'])
    expect(cles(saisie({ lignes: [ligne('606400', 'debit', 100, 'Achats'), ligne('606300', 'debit', 100, 'Achats')] })))
      .toEqual(['desequilibre'])
    const grand = Number.MAX_SAFE_INTEGER
    expect(cles(saisie({ lignes: [ligne('606400', 'debit', grand), ligne('606300', 'debit', 1), ligne('108000', 'credit', grand),
      ligne('108000', 'credit', 1)] }))).toEqual(['desequilibre'])
    const deuxCents = Array.from({ length: 201 }, (_, i) => ligne('606400', i === 0 ? 'credit' : 'debit', i === 0 ? 200 : 1))
    expect(cles(saisie({ lignes: deuxCents }))).toEqual(['nombreDeLignes'])
  })

  it('l’ordre : celui des contrôles de la base, le premier est celui qu’elle dirait', () => {
    const tout = saisie({ date: '2026-01-01', avecExtourne: true, libelle: '', motif: '',
      lignes: [ligne('512000', 'debit', 0, 'Achats')] })
    expect(cles(tout)).toEqual(['dateAVenir', 'extourneHorsDuTrenteEtUn', 'libelle', 'motif', 'nombreDeLignes', 'banque', 'montant',
      'posteHorsDuResultat'])
    // La règle de la trésorerie vient en dernier, après l'équilibre.
    const rattacheeDesequilibree = saisie({ date: '2025-12-31', lignes: [ligne('622600', 'debit', 100, 'Achats'), ligne('408100', 'credit', 99)] })
    expect(cles(rattacheeDesequilibree)).toEqual(['desequilibre', 'rattacheeComptee'])
    expect(Object.keys(MOTS_DES_REFUS)).toHaveLength(22)
  })
})

describe('la règle de la trésorerie devant une charge rattachée (EL-Q3 (A), EXP58-Q3 (A))', () => {
  // L'exemple du cabinet : une dépense payée en janvier 2026, rattachée à 2025 par une charge à payer.
  const rattachee = (poste: string | null) => saisie({
    date: '2025-12-31', libelle: 'Charge à payer — honoraires de décembre', avecExtourne: true,
    lignes: [ligne('622600', 'debit', 50000, poste), ligne('408100', 'credit', 50000)],
  })

  it('hors de la 2035, permise, l’extourne proposée sans être exigée ; comptée, refusée, extourne ou non (EXP58-Q3 (A))', () => {
    expect(estRattachee(rattachee(null).lignes, 'tresorerie')).toBe(true)
    expect(estRattacheeComptee(rattachee(null).lignes, 'tresorerie')).toBe(false)
    expect(cles(rattachee(null))).toEqual([])
    expect(cles({ ...rattachee(null), avecExtourne: false })).toEqual([])
    const comptee = rattachee('Honoraires ne constituant pas des rétrocessions')
    expect(estRattacheeComptee(comptee.lignes, 'tresorerie')).toBe(true)
    expect(cles(comptee)).toEqual(['rattacheeComptee'])
    expect(cles({ ...comptee, avecExtourne: false })).toEqual(['rattacheeComptee'])
    // Un produit rattaché compté (un produit à recevoir, 418) : refusé de même.
    expect(cles(saisie({ date: '2025-12-31', lignes: [ligne('706000', 'credit', 30000, 'Recettes'), ligne('418000', 'debit', 30000)] })))
      .toEqual(['rattacheeComptee'])
    // Une ancienne saisie qui porterait encore la désignation n'y gagne rien : la clé n'est plus lue.
    const ancienne = { ...comptee, contreLaRegle: true }
    expect(cles(ancienne)).toEqual(['rattacheeComptee'])
    // Un reclassement compté n'est pas rattaché ; en engagement, aucun poste ne se porte (le refus est celui du poste).
    expect(cles(saisie())).toEqual([])
    expect(estRattacheeComptee(comptee.lignes, 'engagement')).toBe(false)
    expect(cles(comptee, engagement)).toEqual(['posteEnEngagement'])
  })

  it('la proposition : les lignes de résultat hors de la 2035, l’extourne d’une écriture du 31 décembre ; rien sinon', () => {
    const proposee = propositionDeLaRegle({ ...rattachee('Achats'), avecExtourne: false }, 'tresorerie')
    expect(proposee.lignes.map((l) => l.poste2035)).toEqual([null, null])
    expect(proposee.avecExtourne).toBe(true)
    expect(cles(proposee)).toEqual([])
    expect(Object.keys(proposee).sort()).toEqual(['avecExtourne', 'date', 'libelle', 'lignes', 'motif'])
    expect(propositionDeLaRegle(saisie(), 'tresorerie')).toEqual(saisie())
    expect(propositionDeLaRegle(rattachee('Achats'), 'engagement')).toEqual(rattachee('Achats'))
  })

  it('les avertissements : la règle dite, que la ligne compte ou non ; aucun avertissement « contre la règle »', () => {
    expect(avertissementsDeLEcritureLibre(rattachee(null), 'tresorerie').map((a) => a.cle))
      .toEqual(['horsDeLa2035', 'tiers', 'chargeRattachee'])
    expect(avertissementsDeLEcritureLibre(rattachee('Achats'), 'tresorerie').map((a) => a.cle))
      .toEqual(['tiers', 'chargeRattachee'])
    expect(avertissementsDeLEcritureLibre(rattachee(null), 'engagement').map((a) => a.cle)).toEqual(['tiers', 'inventaire'])
  })
})

describe('les avertissements des comptes que l’application tient (EL-Q5 (A))', () => {
  const avis = (compte: string, mode: 'tresorerie' | 'engagement' = 'tresorerie') =>
    avertissementsDeLEcritureLibre(saisie({ lignes: [ligne(compte, 'debit', 100), ligne('108000', 'credit', 100)] }), mode)
      .map((a) => `${a.cle}@${a.ligne ?? '-'}`)

  it('chaque famille dit ce qui ne suivra pas ; ils ne refusent rien', () => {
    expect(avis('445660')).toEqual(['tva@0'])
    expect(avis('401000')).toEqual(['tiers@0'])
    expect(avis('411000')).toEqual(['tiers@0'])
    expect(avis('218300')).toEqual(['immobilisation@0'])
    expect(avis('281830')).toEqual(['immobilisation@0'])
    expect(avis('164000')).toEqual(['emprunt@0'])
    expect(avis('471000')).toEqual(['passage@0'])
    expect(avis('580000')).toEqual(['passage@0'])
    expect(avis('486000')).toEqual([])
    expect(avis('486000', 'engagement')).toEqual(['inventaire@0'])
    expect(avis('445860', 'engagement')).toEqual(['tva@0', 'inventaire@0'])
    expect(avis('606400')).toEqual(['horsDeLa2035@0'])
    expect(avis('606400', 'engagement')).toEqual([])
    expect(cles(saisie({ lignes: [ligne('445660', 'debit', 100), ligne('108000', 'credit', 100)] }))).toEqual([])
  })
})

describe('la composition que la base recompose', () => {
  it('la constatation à sa date, au journal OD, sous le libellé rogné ; l’extourne au 1er janvier, au sens inverse', () => {
    const s = saisie({ date: '2025-12-31', libelle: '  Charge rattachée  ', avecExtourne: true,
      lignes: [ligne('622600', 'debit', 50000), ligne('408100', 'credit', 50000)] })
    expect(composerEcrituresLibres(s, tresorerie)).toEqual([
      { date: '2025-12-31', journal: 'OD', libelle: 'Charge rattachée',
        lignes: [{ compte: '622600', sens: 'debit', centimes: 50000 }, { compte: '408100', sens: 'credit', centimes: 50000 }] },
      { date: '2026-01-01', journal: 'OD', libelle: 'Extourne — Charge rattachée',
        lignes: [{ compte: '622600', sens: 'credit', centimes: 50000 }, { compte: '408100', sens: 'debit', centimes: 50000 }] },
    ])
    expect(composerEcrituresLibres(saisie(), tresorerie)).toHaveLength(1)
    expect(composerEcrituresLibres(saisie({ libelle: '' }), tresorerie)).toBeNull()
  })

  it('l’écriture pour la base : les noms de ses colonnes, les textes rognés', () => {
    expect(ecritureLibrePourLaBase(saisie({ motif: ' Motif ', lignes: [ligne('606400', 'debit', 1, 'Achats', ' Lib '),
      ligne('606300', 'credit', 1)] }), null, null)).toEqual({
      id: null, date: '2025-06-30', libelle: 'Reclassement des fournitures', motif: 'Motif', piece_citee_id: null,
      avec_extourne: false,
      lignes: [{ compte: '606400', sens: 'debit', centimes: 1, poste_2035: 'Achats', compte_lib: 'Lib' },
        { compte: '606300', sens: 'credit', centimes: 1, poste_2035: null, compte_lib: null }],
    })
  })
})

describe('le poste proposé et l’écart déclaré', () => {
  it('le poste des catégories qui portent le compte, s’il est unique et de sa classe ; nul sinon', () => {
    const categories = [
      { compte_comptable: '606400', poste_2035: 'Fournitures de bureau' },
      { compte_comptable: '606400', poste_2035: 'Fournitures de bureau' },
      { compte_comptable: '625100', poste_2035: 'Frais de déplacements' }, { compte_comptable: '625100', poste_2035: 'Autres frais de déplacements' },
      { compte_comptable: '706000', poste_2035: 'Achats' },
    ]
    expect(posteProposeDuCompte('606400', categories)).toBe('Fournitures de bureau')
    expect(posteProposeDuCompte('625100', categories)).toBeNull()
    expect(posteProposeDuCompte('706000', categories)).toBeNull()
    expect(posteProposeDuCompte('606100', categories)).toBeNull()
  })

  it('en trésorerie, les lignes de résultat hors de la 2035, comptées comme la 2035 les compterait ; rien en engagement', () => {
    const s = saisie({ lignes: [ligne('606400', 'debit', 300), ligne('606300', 'credit', 100), ligne('706000', 'credit', 50),
      ligne('606100', 'debit', 999, 'Achats'), ligne('108000', 'credit', 1149)] })
    expect(ecartDeclare(s, 'tresorerie')).toEqual({ depenses: 200, recettes: 50 })
    expect(ecartDeclare(s, 'engagement')).toEqual({ depenses: 0, recettes: 0 })
  })
})
