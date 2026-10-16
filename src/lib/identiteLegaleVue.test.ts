import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CAPITAL_ILLISIBLE, COLONNES_IDENTITE_LEGALE, FORME_NON_RENSEIGNEE, IDENTITE_NON_ENREGISTREE, PHRASE_IDENTITE_LEGALE,
  RAISON_DENOMINATION_EI, capitalPourSaisie, choixDeForme, colonnesEcrites, ecritureQuiPart, estEntrepreneurIndividuel,
  identiteDepuisLaReponse, identiteLegaleLue, identiteQuiPart, lireCapital, phraseDuCapitalRemisANul,
  propositionDeDenomination, refusDeLIdentite, refusDeLaBase, saisieDepuisLaLigne,
  type IdentiteLue, type SaisieIdentite,
} from './identiteLegaleVue'
import { CATEGORIES_JURIDIQUES } from './categoriesJuridiques'
import { CAPITAL_BORNE, DENOMINATION_MAX, REFUS_IDENTITE_LEGALE, RCS_VILLE_MAX } from './parametresFacturation'

// Jeux d'essai fictifs, typés `Partial<T> => T`.
const ligne = (p: Partial<IdentiteLue> = {}): IdentiteLue => ({
  siret: null, adresse: null, denomination_imprimee: null, rcs_ville: null, forme_juridique: null, capital: null, ...p,
})
const saisie = (p: Partial<SaisieIdentite> = {}): SaisieIdentite => ({
  siret: '', adresse: '', denomination: '', rcsVille: '', forme: '', capital: '', ...p,
})
const SOCIETE = '5710' // SAS
const MESSAGE = (cle: string) => REFUS_IDENTITE_LEGALE.find((r) => r.cle === cle)?.message

describe('le capital tapé se lit sans être changé', () => {
  it('lit un champ vide comme « rien » : nul, jamais zéro', () => {
    expect(lireCapital('')).toBeNull()
    expect(lireCapital('   ')).toBeNull()
    expect(lireCapital(' \u00a0\u202f ')).toBeNull()
  })

  it.each([
    ['1 500,50', 1500.5],
    ['1500.5', 1500.5],
    ['1500,5', 1500.5],
    ['150000', 150000],
    ['10 €', 10],
    ['1\u00a0500,50\u00a0€', 1500.5], // ce que `formatMoney` écrit : insécable et « € »
    ['1\u202f500,50', 1500.5], // l'espace fine insécable
    ['1\u2009500,50', 1500.5], // l'espace fine
    ['0,01', 0.01],
    ['0000150', 150],
    ['150,00', 150],
    ['9 999 999 999 999,99', 9999999999999.99],
  ])('lit « %s » comme %s', (texte, attendu) => {
    expect(lireCapital(texte)).toBe(attendu)
  })

  it.each([
    ['12,345'],
    ['12.345'],
    ['0,10000000000000000001'], // deviendrait 0,1 : arrondir sans le dire
    ['-5'],
    ['+5'],
    ['1e3'],
    ['1E3'],
    ['1,500.50'],
    ['1.500,50'],
    ['1.5.0'],
    [',5'],
    ['.5'],
    ['5,'],
    ['5.'],
    ['dix mille'],
    ['10 euros'],
    ['0x10'],
    ['NaN'],
    ['Infinity'],
    ['1/2'],
    ['１２'], // des chiffres pleine chasse : pas ceux que la base lit
  ])('refuse « %s » : illisible, dit avant le clic, jamais arrondi', (texte) => {
    expect(lireCapital(texte)).toBe('illisible')
  })

  it('lit la borne sans la juger : c’est la contrainte, redite par le module, qui la refuse', () => {
    expect(lireCapital('9999999999999,99')).toBe(9999999999999.99)
    expect(lireCapital('10000000000000')).toBe(CAPITAL_BORNE)
    expect(refusDeLIdentite(saisie({ forme: SOCIETE, capital: '9999999999999,99' }), true)).toBeNull()
    expect(refusDeLIdentite(saisie({ forme: SOCIETE, capital: '10 000 000 000 000' }), true)?.cle).toBe('capital')
    expect(refusDeLIdentite(saisie({ forme: SOCIETE, capital: '9'.repeat(400) }), true)?.cle).toBe('capital')
  })

  it('le zéro se lit, et le module le refuse : un capital est strictement positif', () => {
    expect(lireCapital('0')).toBe(0)
    expect(refusDeLIdentite(saisie({ forme: SOCIETE, capital: '0,00' }), true)).toEqual({
      cle: 'capital', contrainte: 'dossiers_capital_forme', message: MESSAGE('capital'),
    })
  })
})

describe('le capital fait l’aller-retour lecture → formulaire → départ sans changer de valeur', () => {
  it.each([0.01, 1, 1500.5, 150000, 9999999999999.99])('%s revient identique', (n) => {
    const texte = capitalPourSaisie(n)
    expect(lireCapital(texte)).toBe(n)
    expect(identiteQuiPart(saisie({ forme: SOCIETE, capital: texte })).identite.capital).toBe(n)
  })

  it('écrit le capital au centime, la virgule pour décimale, sans séparateur de milliers', () => {
    expect(capitalPourSaisie(150000)).toBe('150000,00')
    expect(capitalPourSaisie(0.01)).toBe('0,01')
    expect(capitalPourSaisie(1500.5)).toBe('1500,50')
    expect(capitalPourSaisie(9999999999999.99)).toBe('9999999999999,99')
    expect(capitalPourSaisie(null)).toBe('')
    expect(capitalPourSaisie(undefined)).toBe('')
  })

  it('tient sur un balayage de centimes, du plus petit au plus grand que la base admet', () => {
    // Un pas géométrique, du centime à la borne : chaque valeur est celle que PostgREST rendrait (le nombre de son écriture
    // décimale), puis écrite pour la saisie et relue.
    let essais = 0
    for (let c = 1; c < 1e15; c = Math.floor(c * 1.37) + 1) {
      const entier = String(Math.floor(c / 100))
      const decimales = String(c % 100).padStart(2, '0')
      const rendu = Number(`${entier}.${decimales}`)
      if (!(rendu < CAPITAL_BORNE)) break
      expect(lireCapital(capitalPourSaisie(rendu)), `${entier},${decimales}`).toBe(rendu)
      essais += 1
    }
    expect(essais).toBeGreaterThan(70)
  })
})

describe('la ligne du dossier devient la saisie du formulaire', () => {
  it('une colonne nulle est un champ vide, une colonne lue est son texte', () => {
    expect(saisieDepuisLaLigne(ligne())).toEqual(saisie())
    expect(saisieDepuisLaLigne(ligne({
      siret: '12345678901234', adresse: '1 rue des Essais', denomination_imprimee: 'Société Fictive', rcs_ville: 'Lyon',
      forme_juridique: SOCIETE, capital: 150000,
    }))).toEqual(saisie({
      siret: '12345678901234', adresse: '1 rue des Essais', denomination: 'Société Fictive', rcsVille: 'Lyon', forme: SOCIETE, capital: '150000,00',
    }))
  })

  it('les quatre colonnes ne sont lues que toutes ensemble : une seule absente, et rien ne s’offre', () => {
    expect(identiteLegaleLue(ligne())).toBe(true)
    for (const colonne of COLONNES_IDENTITE_LEGALE) {
      expect(identiteLegaleLue(ligne({ [colonne]: undefined })), colonne).toBe(false)
    }
    expect(identiteLegaleLue(ligne({
      denomination_imprimee: undefined, rcs_ville: undefined, forme_juridique: undefined, capital: undefined,
    }))).toBe(false)
  })

  it('une colonne absente n’est pas écrite : l’écriture et la relecture se limitent au SIRET et à l’adresse', () => {
    const s = saisie({ siret: ' 123 ', adresse: ' rue ', denomination: 'X', forme: SOCIETE, capital: '5' })
    expect(Object.keys(ecritureQuiPart(s, false))).toEqual(['siret', 'adresse'])
    expect(ecritureQuiPart(s, false)).toEqual({ siret: '123', adresse: 'rue' })
    expect(colonnesEcrites(false)).toBe('siret, adresse')
    expect(Object.keys(ecritureQuiPart(s, true))).toEqual([
      'siret', 'adresse', 'denomination_imprimee', 'rcs_ville', 'forme_juridique', 'capital',
    ])
    expect(colonnesEcrites(true)).toBe('siret, adresse, denomination_imprimee, rcs_ville, forme_juridique, capital')
  })

  it('refuse de juger ce qu’elle n’offre pas : sans les quatre colonnes lues, aucun refus', () => {
    expect(refusDeLIdentite(saisie({ forme: SOCIETE, capital: '12,345', denomination: 'x'.repeat(500) }), false)).toBeNull()
  })

  it('relit la réponse de la base comme une ligne du dossier — les quatre colonnes seulement si elles étaient écrites', () => {
    const rendue = { siret: '123', adresse: null, denomination_imprimee: 'D', rcs_ville: 'Lyon', forme_juridique: SOCIETE, capital: 12.5 }
    expect(identiteDepuisLaReponse(rendue, true)).toEqual(ligne({
      siret: '123', denomination_imprimee: 'D', rcs_ville: 'Lyon', forme_juridique: SOCIETE, capital: 12.5,
    }))
    expect(identiteDepuisLaReponse({ siret: '123', adresse: 'a' }, false)).toEqual({
      siret: '123', adresse: 'a', denomination_imprimee: undefined, rcs_ville: undefined, forme_juridique: undefined, capital: undefined,
    })
  })
})

describe('l’identité telle qu’elle part', () => {
  it('retire les blancs des bords, et un champ vide vaut nul', () => {
    const { identite, capitalIllisible } = identiteQuiPart(saisie({
      siret: '  12345678901234 ', adresse: '\n 1 rue des Essais\t', denomination: ' Société Fictive ', rcsVille: '   ', forme: SOCIETE, capital: ' 1 500,5 ',
    }))
    expect(identite).toEqual({
      siret: '12345678901234', adresse: '1 rue des Essais', denomination_imprimee: 'Société Fictive', rcs_ville: null,
      forme_juridique: SOCIETE, capital: 1500.5,
    })
    expect(capitalIllisible).toBe(false)
  })

  it('un capital illisible ne part pas : nul, et dit illisible', () => {
    const r = identiteQuiPart(saisie({ forme: SOCIETE, capital: '12,345' }))
    expect(r.capitalIllisible).toBe(true)
    expect(r.identite.capital).toBeNull()
  })

  it('l’entrepreneur individuel part sans capital, même avec une saisie dans le champ caché, même illisible', () => {
    expect(estEntrepreneurIndividuel('1000')).toBe(true)
    expect(estEntrepreneurIndividuel(SOCIETE)).toBe(false)
    expect(estEntrepreneurIndividuel('')).toBe(false)
    const r = identiteQuiPart(saisie({ forme: '1000', capital: '150000,00' }))
    expect(r.identite.capital).toBeNull()
    expect(r.capitalIllisible).toBe(false)
    const illisible = identiteQuiPart(saisie({ forme: '1000', capital: 'abc' }))
    expect(illisible.identite.capital).toBeNull()
    expect(illisible.capitalIllisible).toBe(false)
    expect(refusDeLIdentite(saisie({ forme: '1000', capital: 'abc' }), true)).toBeNull()
    expect(ecritureQuiPart(saisie({ forme: '1000', capital: '150000,00' }), true).capital).toBeNull()
  })
})

describe('le refus, dit avant le clic', () => {
  it('une saisie juste ne refuse rien, vide comprise', () => {
    expect(refusDeLIdentite(saisie(), true)).toBeNull()
    expect(refusDeLIdentite(saisie({ denomination: 'Société Fictive', rcsVille: 'Lyon', forme: SOCIETE, capital: '150 000,00' }), true)).toBeNull()
  })

  it('dit d’abord le capital illisible, avant tout refus du module', () => {
    const s = saisie({ forme: SOCIETE, capital: '12,345', denomination: 'x'.repeat(DENOMINATION_MAX + 1) })
    expect(refusDeLIdentite(s, true)).toEqual({ cle: 'capital_illisible', contrainte: null, message: CAPITAL_ILLISIBLE })
  })

  it('puis rend le premier refus du module, dans l’ordre de ses contraintes, sous ses mots', () => {
    const trop = 'x'.repeat(DENOMINATION_MAX + 1)
    const ville = 'y'.repeat(RCS_VILLE_MAX + 1)
    // Le capital passe avant la dénomination, la dénomination avant la ville du greffe.
    expect(refusDeLIdentite(saisie({ forme: SOCIETE, capital: '0', denomination: trop, rcsVille: ville }), true)?.cle).toBe('capital')
    expect(refusDeLIdentite(saisie({ forme: SOCIETE, denomination: trop, rcsVille: ville }), true)).toEqual({
      cle: 'denomination', contrainte: 'dossiers_denomination_imprimee_forme', message: MESSAGE('denomination'),
    })
    expect(refusDeLIdentite(saisie({ rcsVille: ville }), true)).toEqual({
      cle: 'rcs_ville', contrainte: 'dossiers_rcs_ville_forme', message: MESSAGE('rcs_ville'),
    })
  })

  it('juge la dénomination et la ville sur ce qui part : les blancs des bords ne comptent pas, deux cents caractères passent', () => {
    expect(refusDeLIdentite(saisie({ denomination: ` ${'x'.repeat(DENOMINATION_MAX)} ` }), true)).toBeNull()
    expect(refusDeLIdentite(saisie({ denomination: 'x'.repeat(DENOMINATION_MAX + 1) }), true)?.cle).toBe('denomination')
    expect(refusDeLIdentite(saisie({ rcsVille: 'y'.repeat(RCS_VILLE_MAX) }), true)).toBeNull()
  })

  it('refuse une forme que la nomenclature ne connaît pas, et le dit sous les mots du module', () => {
    expect(refusDeLIdentite(saisie({ forme: '9999' }), true)).toEqual({
      cle: 'forme_juridique', contrainte: 'dossiers_forme_juridique_insee', message: MESSAGE('forme_juridique'),
    })
  })
})

describe('les choix de la forme juridique', () => {
  it('« Non renseignée », puis les catégories de l’INSEE dans l’ordre de la nomenclature, sous leur code', () => {
    const choix = choixDeForme('')
    expect(choix[0]).toEqual({ valeur: '', libelle: FORME_NON_RENSEIGNEE })
    expect(choix).toHaveLength(1 + CATEGORIES_JURIDIQUES.length)
    expect(CATEGORIES_JURIDIQUES).toHaveLength(260)
    expect(choix.slice(1).map((c) => c.valeur)).toEqual(CATEGORIES_JURIDIQUES.map((c) => c.code))
    expect(choix.slice(1).map((c) => c.libelle)).toEqual(CATEGORIES_JURIDIQUES.map((c) => `${c.code} — ${c.libelle}`))
    expect(new Set(choix.map((c) => c.valeur)).size).toBe(261)
  })

  it('un code connu ne change pas la liste', () => {
    expect(choixDeForme(SOCIETE)).toEqual(choixDeForme(''))
  })

  it('un code que la nomenclature ne connaît pas se DIT tel quel, en tête — jamais remplacé en silence', () => {
    const choix = choixDeForme('9999')
    expect(choix).toHaveLength(262)
    expect(choix[1]).toEqual({ valeur: '9999', libelle: '9999 — code que la nomenclature de l’INSEE ne connaît pas' })
    expect(choix.filter((c) => c.valeur === '9999')).toHaveLength(1)
  })
})

describe('l’entrepreneur individuel : la dénomination proposée, et son capital remis à nul', () => {
  const NOM = 'Jeanne Exemple'

  it('propose « <nom> EI » avec sa raison quand la forme est 1000 et que la saisie diffère', () => {
    expect(propositionDeDenomination(NOM, saisie({ forme: '1000' }))).toEqual({ texte: 'Jeanne Exemple EI', raison: RAISON_DENOMINATION_EI })
    expect(RAISON_DENOMINATION_EI).toContain('R526-27')
    expect(RAISON_DENOMINATION_EI).toContain('« EI »')
    // L'article dit « immédiatement » : la mention colle au nom.
    expect(RAISON_DENOMINATION_EI).toContain('précédé ou suivi immédiatement')
    expect(propositionDeDenomination(NOM, saisie({ forme: '1000', denomination: 'Autre nom' }))?.texte).toBe('Jeanne Exemple EI')
  })

  it('ne propose rien tant que la forme n’est pas connue, ni pour une autre forme', () => {
    expect(propositionDeDenomination(NOM, saisie({ forme: '' }))).toBeNull()
    expect(propositionDeDenomination(NOM, saisie({ forme: SOCIETE }))).toBeNull()
    expect(propositionDeDenomination(NOM, saisie({ forme: '9999' }))).toBeNull()
  })

  it('ne propose rien quand la saisie est déjà la proposition, blancs des bords ignorés', () => {
    expect(propositionDeDenomination(NOM, saisie({ forme: '1000', denomination: 'Jeanne Exemple EI' }))).toBeNull()
    expect(propositionDeDenomination(NOM, saisie({ forme: '1000', denomination: '  Jeanne Exemple EI ' }))).toBeNull()
  })

  it('un nom déjà suivi de « EI » ne le reçoit pas deux fois ; un nom vide ne propose rien', () => {
    expect(propositionDeDenomination('Jeanne Exemple EI', saisie({ forme: '1000' }))?.texte).toBe('Jeanne Exemple EI')
    expect(propositionDeDenomination('Jeanne Exemple EI', saisie({ forme: '1000', denomination: 'Jeanne Exemple EI' }))).toBeNull()
    expect(propositionDeDenomination('Jeanne Exemple entrepreneur individuel', saisie({ forme: '1000' }))?.texte)
      .toBe('Jeanne Exemple entrepreneur individuel')
    expect(propositionDeDenomination('   ', saisie({ forme: '1000' }))).toBeNull()
  })

  it('dit le capital enregistré qui sera effacé, ou le capital saisi qui ne sera pas écrit — avant le clic', () => {
    const lu = phraseDuCapitalRemisANul(saisie({ forme: '1000', capital: '150000,00' }), 150000)
    expect(lu).toContain('capital enregistré')
    expect(lu).toContain('sera effacé')
    expect(lu).toContain('150')
    expect(phraseDuCapitalRemisANul(saisie({ forme: '1000', capital: '5000' }), null)).toContain('capital saisi ne sera pas enregistré')
    expect(phraseDuCapitalRemisANul(saisie({ forme: '1000', capital: '   ' }), null)).toBeNull()
    expect(phraseDuCapitalRemisANul(saisie({ forme: '1000' }), undefined)).toBeNull()
  })

  it('ne dit rien d’un capital pour une société, ni quand la forme n’est pas choisie', () => {
    expect(phraseDuCapitalRemisANul(saisie({ forme: SOCIETE, capital: '5000' }), 5000)).toBeNull()
    expect(phraseDuCapitalRemisANul(saisie({ forme: '', capital: '5000' }), 5000)).toBeNull()
  })
})

describe('le refus de la base, dit sous les mots du module', () => {
  const REPLI = 'repli'
  const violation = (contrainte: string) => ({
    code: '23514', message: `new row for relation "dossiers" violates check constraint "${contrainte}"`, details: null, hint: null,
  })

  it.each(REFUS_IDENTITE_LEGALE.map((r) => [r.cle, r.contrainte, r.message]))('la contrainte %s (%s) rend le message du module', (_cle, contrainte, message) => {
    expect(refusDeLaBase(violation(contrainte), REPLI)).toBe(message)
  })

  it('les cinq contraintes sont toutes distinctes, et aucune n’est le préfixe d’une autre', () => {
    const noms = REFUS_IDENTITE_LEGALE.map((r) => r.contrainte)
    expect(new Set(noms).size).toBe(5)
    // `dossiers_capital_d_une_societe` et `dossiers_capital_forme` partagent un début : chacune dit SON message.
    expect(refusDeLaBase(violation('dossiers_capital_d_une_societe'), REPLI)).toBe(MESSAGE('capital_d_un_entrepreneur_individuel'))
    expect(refusDeLaBase(violation('dossiers_capital_forme'), REPLI)).toBe(MESSAGE('capital'))
  })

  it('une autre erreur passe par messageErreur : son message, ou le repli', () => {
    expect(refusDeLaBase({ code: '23505', message: 'duplicate key value violates unique constraint "dossiers_siret_key"' }, REPLI))
      .toBe('duplicate key value violates unique constraint "dossiers_siret_key"')
    expect(refusDeLaBase({ code: '42501', message: 'new row violates row-level security policy for table "dossiers"' }, REPLI))
      .toBe('new row violates row-level security policy for table "dossiers"')
    expect(refusDeLaBase({ code: '23514', message: 'violates check constraint "dossiers_autre"' }, REPLI))
      .toBe('violates check constraint "dossiers_autre"')
    expect(refusDeLaBase({}, REPLI)).toBe(REPLI)
    expect(refusDeLaBase(null, REPLI)).toBe(REPLI)
    expect(refusDeLaBase(new Error('Failed to fetch'), REPLI)).toBe('Failed to fetch')
  })

  it('le nom d’une contrainte ne suffit pas : il faut une violation de contrainte de contrôle (23514)', () => {
    expect(refusDeLaBase({ code: '42501', message: 'violates check constraint "dossiers_capital_forme"' }, REPLI))
      .toBe('violates check constraint "dossiers_capital_forme"')
    expect(refusDeLaBase({ message: 'violates check constraint "dossiers_capital_forme"' }, REPLI))
      .toBe('violates check constraint "dossiers_capital_forme"')
  })
})

describe('ce que la carte dit en phrase', () => {
  it('dit qu’aucune facture ne lit ni n’imprime encore ces champs, sans redire le SIRET et l’adresse que la carte dit déjà repris', () => {
    expect(PHRASE_IDENTITE_LEGALE).toContain('Aucune facture ne lit ni n’imprime encore')
    // La phrase qui la précède dans la carte dit déjà que le SIRET et l'adresse sont repris sur chaque nouvelle facture.
    expect(PHRASE_IDENTITE_LEGALE).not.toMatch(/SIRET|adresse/)
  })

  it('une écriture sans ligne rendue ne prétend rien', () => {
    expect(IDENTITE_NON_ENREGISTREE).toMatch(/^Rien n’a été enregistré/)
  })
})

describe('le module reste pur', () => {
  it('n’importe jamais supabase.ts', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/identiteLegaleVue.ts'), 'utf8')
    expect(source).not.toMatch(/from '\.\/supabase'/)
    expect(source).not.toMatch(/@supabase\//)
  })
})
