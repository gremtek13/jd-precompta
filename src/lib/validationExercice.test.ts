import { describe, expect, it } from 'vitest'
import {
  biensFiges, casesDeLInstantane, casesQuiDifferent, dateFigee, defautsDeNumerotation, demandeDeValidation, exerciceQuiFige,
  frontiereDeValidation, instantane2035, lireInstantane2035, piecesFigees,
} from './validationExercice'
import { numeroterFec, type NumerotationFec } from './fec'
import { COMPTE_BANQUE } from './comptes'
import type { Declaration2035 } from './declaration2035'
import type { ANouveau, EcritureBrouillon, Immobilisation, Piece } from './types'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'

const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null, date: '2025-03-10', compte: '606100',
  libelle: 'Fournisseur', montant: 100, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null,
  ...NON_VALIDEE, created_at: '2025-03-10T09:00:00Z', ...o,
})

const piece = (id: string, o: Partial<Piece> = {}): Piece => ({
  id, dossier_id: 'd1', nom_fichier: `${id}.pdf`, statut: 'validee', type_piece: 'achat', date_piece: '2025-03-10',
  montant_ht: null, montant_tva: null, montant_ttc: 100, tiers: null, categorie_id: null, sous_dossier_id: null, notes: null,
  created_at: '2025-03-10T00:00:00Z', ...o,
} as Piece)

describe('la frontière et l’exercice qui fige une date — les mots de la base', () => {
  it('pose la frontière au 31 décembre du dernier exercice validé', () => {
    expect(frontiereDeValidation([])).toBeNull()
    expect(frontiereDeValidation([2024, 2025])).toBe('2025-12-31')
    expect(frontiereDeValidation([2025, 2024])).toBe('2025-12-31')
  })

  it('dit « validé » d’un exercice validé, et rien d’un exercice que la frontière ne touche pas', () => {
    expect(exerciceQuiFige(2025, [2025])).toBe("L'exercice 2025 est validé")
    expect(exerciceQuiFige(2026, [2025])).toBeNull()
    expect(exerciceQuiFige(2025, [])).toBeNull()
  })

  // Le défaut de la migration corrective du 04/10/2026, côté écran : un relevé de 2024 sur un dossier repris
  // en 2025 et validé pour 2025 n'est PAS « validé », 2024 est dans les comptes repris.
  it('dit d’un exercice antérieur au premier validé qu’il est figé par celui-là, jamais qu’il est validé', () => {
    expect(exerciceQuiFige(2024, [2025])).toBe("L'exercice 2024 est figé par la validation de l'exercice 2025")
    // Le PREMIER exercice validé qui lui est postérieur, pas le dernier.
    expect(exerciceQuiFige(2023, [2025, 2026, 2027])).toBe("L'exercice 2023 est figé par la validation de l'exercice 2025")
  })

  it('juge une date sur son année', () => {
    expect(dateFigee('2025-12-31', [2025])).toBe("L'exercice 2025 est validé")
    expect(dateFigee('2026-01-01', [2025])).toBeNull()
  })
})

describe('ce que la base refusera de modifier', () => {
  const bien: Immobilisation = {
    id: 'b1', piece_id: 'p-bien',
  } as Immobilisation

  it('fige une pièce qui porte une écriture validée, à l’exercice de la première', () => {
    const figees = piecesFigees([
      ecriture({ piece_id: 'p1', statut: 'validee', date: '2025-06-01' }),
      ecriture({ piece_id: 'p1', statut: 'validee', date: '2024-12-31' }),
      ecriture({ piece_id: 'p2', statut: 'proposee', date: '2024-03-01' }),
    ], [])
    expect([...figees]).toEqual([['p1', 2024]])
  })

  it('fige aussi la pièce d’un bien dont la dotation est validée', () => {
    const figees = piecesFigees([ecriture({ piece_id: null, immobilisation_id: 'b1', statut: 'validee', date: '2025-12-31' })], [bien])
    expect(figees.get('p-bien')).toBe(2025)
  })

  it('fige un bien par sa dotation validée ou par son acquisition validée', () => {
    expect(biensFiges([ecriture({ piece_id: null, immobilisation_id: 'b1', statut: 'validee', date: '2025-12-31' })], [bien]).get('b1')).toBe(2025)
    expect(biensFiges([ecriture({ piece_id: 'p-bien', statut: 'validee', date: '2024-05-02' })], [bien]).get('b1')).toBe(2024)
    // Le garde symétrique : des écritures proposées ne figent rien.
    expect(biensFiges([ecriture({ piece_id: 'p-bien' }), ecriture({ piece_id: null, immobilisation_id: 'b1' })], [bien]).size).toBe(0)
  })
})

describe('defautsDeNumerotation — ce que la base refusera, nommé', () => {
  const achat = piece('achat', { tiers: 'Transmedical', montant_ttc: 120, nom_fichier: 'facture-mars.pdf' })
  const juste = () => numeroterFec([
    ecriture({ id: 'a1', piece_id: 'achat', compte: '606100', montant: 120 }),
    ecriture({ id: 'a2', piece_id: 'achat', compte: COMPTE_BANQUE, sens: 'credit', montant: 120, ligne_bancaire_id: 'l1' }),
  ], [achat], [], [], 'tresorerie', [])

  it('ne trouve rien à redire à une numérotation que `numeroterFec` produit sur un brouillon juste', () => {
    expect(defautsDeNumerotation(juste())).toEqual([])
  })

  // Le cas courant en trésorerie : une pièce dont le paiement n'est pas rapproché n'a pas sa contrepartie.
  it('nomme l’écriture déséquilibrée, sa pièce et son écart en centimes', () => {
    const n = numeroterFec([ecriture({ id: 'a1', piece_id: 'achat', compte: '606100', montant: 120 })], [achat], [], [], 'tresorerie', [])
    expect(defautsDeNumerotation(n)).toEqual([
      { type: 'desequilibre', journal: 'AC', numero: 1, pieceRef: 'facture-mars.pdf', ecartCentimes: 12000 },
    ])
  })

  // En flottants, 0,1 + 0,2 − 0,3 ne vaut pas zéro : l'écriture juste serait déclarée déséquilibrée.
  // 0,07 + 0,14 − 0,21 ne fait pas zéro en virgule flottante (il reste 3,6e-15) : une écriture juste paraîtrait
  // déséquilibrée, et la validation serait refusée sans raison qu'on puisse montrer.
  it('compte en centimes entiers', () => {
    const n = numeroterFec([
      ecriture({ id: 'a1', piece_id: 'achat', compte: '606100', montant: 0.07 }),
      ecriture({ id: 'a2', piece_id: 'achat', compte: '445660', montant: 0.14 }),
      ecriture({ id: 'a3', piece_id: 'achat', compte: COMPTE_BANQUE, sens: 'credit', montant: 0.21, ligne_bancaire_id: 'l1' }),
    ], [achat], [], [], 'tresorerie', [])
    expect(defautsDeNumerotation(n)).toEqual([])
  })

  // Les contrôles que `numeroterFec` tient par construction : refaits quand même, sur des numérotations
  // fabriquées à la main, pour que la base ne soit jamais la première à les voir.
  it('refait les autres contrôles de la base', () => {
    const base = juste()
    const avec = (modifier: (n: NumerotationFec) => void) => {
      const n: NumerotationFec = structuredClone(base)
      modifier(n)
      return defautsDeNumerotation(n).map((d) => d.type)
    }
    expect(avec((n) => { n.lignes[0].pieceRef = ' ' })).toContain('incomplete')
    expect(avec((n) => { n.lignes[0].compAuxNum = 'FX' })).toContain('incomplete')
    expect(avec((n) => { for (const l of n.lignes) l.numero = 2 })).toContain('numeros')
    expect(avec((n) => { n.lignes[1].pieceRef = 'autre.pdf' })).toContain('pieces')
    expect(avec((n) => { n.lignes[1].pieceDate = '2025-03-11' })).toContain('pieces')
    expect(avec((n) => { n.lignes.push({ ...n.lignes[0], ecriture: { ...n.lignes[0].ecriture, id: 'x' }, compteLib: 'Autre' }) }))
      .toContain('compte')
    expect(avec((n) => {
      n.lignes[0].compAuxNum = 'FX'; n.lignes[0].compAuxLib = 'X'
      n.lignes[1].compAuxNum = 'FX'; n.lignes[1].compAuxLib = 'Y'
    })).toContain('auxiliaire')
  })

  it('voit des numéros qui ne suivent pas l’ordre des dates', () => {
    const n = numeroterFec([
      ecriture({ id: 'a1', piece_id: 'achat', date: '2025-03-10' }),
      ecriture({ id: 'a2', piece_id: 'achat', date: '2025-03-10', compte: COMPTE_BANQUE, sens: 'credit', ligne_bancaire_id: 'l1' }),
      ecriture({ id: 'b1', piece_id: 'b', date: '2025-04-10' }),
      ecriture({ id: 'b2', piece_id: 'b', date: '2025-04-10', compte: COMPTE_BANQUE, sens: 'credit', ligne_bancaire_id: 'l2' }),
    ], [achat, piece('b', { date_piece: '2025-04-10' })], [], [], 'tresorerie', [])
    expect(defautsDeNumerotation(n)).toEqual([])
    for (const l of n.lignes) l.numero = l.numero === 1 ? 2 : 1
    expect(defautsDeNumerotation(n)).toEqual([{ type: 'ordre', journal: 'AC', numero: 2 }])
  })

  it('voit un compte qui porte deux libellés, à-nouveau compris', () => {
    const ouverture: ANouveau = {
      id: 'an1', dossier_id: 'd1', date: '2025-01-01', compte: COMPTE_BANQUE, compte_origine: '512', libelle: 'Banque',
      sens: 'debit', montant: 10, source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE,
      created_at: '2025-02-01T00:00:00Z',
    }
    const n = numeroterFec([], [], [], [ouverture], 'tresorerie', [])
    n.lignes.push({ ...juste().lignes[1], compteLib: 'Compte courant' })
    expect(defautsDeNumerotation(n).map((d) => d.type)).toContain('compte')
  })
})

describe('demandeDeValidation — ce que `valider_exercice` reçoit', () => {
  it('reprend la numérotation du FEC, ligne pour ligne, et les libellés des à-nouveaux', () => {
    const achat = piece('achat', { tiers: 'Transmedical', nom_fichier: 'facture-mars.pdf' })
    const ouverture: ANouveau = {
      id: 'an1', dossier_id: 'd1', date: '2025-01-01', compte: COMPTE_BANQUE, compte_origine: '51210000', libelle: 'BNP',
      sens: 'debit', montant: 10, source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE,
      created_at: '2025-02-01T00:00:00Z',
    }
    const n = numeroterFec([
      ecriture({ id: 'a1', piece_id: 'achat', compte: '606100' }),
      ecriture({ id: 'a2', piece_id: 'achat', compte: '401000', sens: 'credit' }),
    ], [achat], [], [ouverture], 'engagement', [])
    expect(demandeDeValidation(n, null)).toEqual({
      p_lignes: [
        { id: 'a1', journal: 'AC', numero: 1, piece_ref: 'facture-mars.pdf', piece_date: '2025-03-10', compte_lib: '606100', comp_aux_num: null, comp_aux_lib: null },
        { id: 'a2', journal: 'AC', numero: 1, piece_ref: 'facture-mars.pdf', piece_date: '2025-03-10', compte_lib: 'Fournisseurs', comp_aux_num: 'FTRANSMEDICAL', comp_aux_lib: 'Transmedical' },
      ],
      p_a_nouveaux: [{ id: 'an1', compte_lib: 'Banque', ecriture_lib: 'À-nouveau 51210000 BNP' }],
      p_declaration: null,
    })
  })
})

describe('l’instantané de la 2035 — la déclaration telle qu’elle a été validée', () => {
  const declaration: Declaration2035 = {
    annee: 2025,
    recettes: [{ poste: 'Recettes', nature: 'recette', montant: 5000.4, nbPieces: 3, nbMouvements: 12 }],
    depenses: [{ poste: 'Achats', nature: 'depense', montant: 120.6, nbPieces: 2, nbMouvements: 0 }],
    totalRecettes: 5000.4,
    totalDepenses: 120.6,
    resultat: 4879.8,
    exclusions: { sansPoste: [], sansDate: [], sansMontant: [], mouvementsSansPoste: [], mouvementsHorsResultat: [] },
    sansPaiementConnu: [],
    indemnitesKilometriques: null,
    contributions: [],
  }
  const valeurs = new Map([['AG', 5000.4], ['BA', 120.6], ['CP', 4879.8]])
  const formulaire = new Map([['AG', 5000], ['BA', 121], ['CP', 4879]])
  const entete = { nom: 'Cabinet infirmier', activite: 'Soins infirmiers', siret: '12345678900012' }

  it('garde les cases au centime, celles du formulaire, les postes et le déclarant', () => {
    const i = instantane2035(declaration, valeurs, formulaire, entete)
    expect(i).toEqual({
      version: 1,
      annee: 2025,
      cases: { AG: 5000.4, BA: 120.6, CP: 4879.8 },
      formulaire: { AG: 5000, BA: 121, CP: 4879 },
      totalRecettes: 5000.4,
      totalDepenses: 120.6,
      resultat: 4879.8,
      postes: [
        { poste: 'Recettes', nature: 'recette', montant: 5000.4, nbPieces: 3, nbMouvements: 12 },
        { poste: 'Achats', nature: 'depense', montant: 120.6, nbPieces: 2, nbMouvements: 0 },
      ],
      entete,
    })
  })

  // Ce qu'on relit de la base passe par le JSON : l'aller-retour doit rendre le même instantané.
  it('se relit tel qu’il a été gardé, après un aller-retour par la base', () => {
    const i = instantane2035(declaration, valeurs, formulaire, entete)
    expect(lireInstantane2035(JSON.parse(JSON.stringify(i)))).toEqual(i)
    expect(casesDeLInstantane(i.formulaire).get('BA')).toBe(121)
  })

  // Un instantané illisible ne s'affiche pas comme une 2035 vide : l'écran le dit.
  it('refuse ce qui n’est pas un instantané, plutôt que de le deviner', () => {
    const i = instantane2035(declaration, valeurs, formulaire, entete)
    expect(lireInstantane2035(null)).toBeNull()
    expect(lireInstantane2035([])).toBeNull()
    expect(lireInstantane2035({ ...i, version: 2 })).toBeNull()
    expect(lireInstantane2035({ ...i, cases: { AG: '5000' } })).toBeNull()
    expect(lireInstantane2035({ ...i, formulaire: null })).toBeNull()
    expect(lireInstantane2035({ ...i, resultat: Number.NaN })).toBeNull()
    expect(lireInstantane2035({ ...i, postes: [{ poste: 'x', nature: 'autre', montant: 1 }] })).toBeNull()
    expect(lireInstantane2035({ ...i, entete: { nom: 3, activite: null, siret: null } })).toBeNull()
    expect(lireInstantane2035({ ...i, entete: undefined })).toBeNull()
  })

  // La 2035 validée fait foi ; recalculée aujourd'hui, elle peut ne plus s'y retrouver — un poste de catégorie
  // changé, un calcul qui a évolué. L'écran nomme les cases qui diffèrent, au centime.
  it('nomme les cases où la 2035 recalculée ne retrouve plus la validée', () => {
    const i = instantane2035(declaration, valeurs, formulaire, entete)
    expect(casesQuiDifferent(i, valeurs)).toEqual([])
    expect(casesQuiDifferent(i, new Map([['AG', 5000.404], ['BA', 120.6], ['CP', 4879.8]]))).toEqual([])
    expect(casesQuiDifferent(i, new Map([['AG', 5000.41], ['BA', 120.6], ['CP', 4879.81]]))).toEqual(['AG', 'CP'])
    // Une case qui n'existe que d'un côté vaut zéro de l'autre.
    expect(casesQuiDifferent(i, new Map([['AG', 5000.4], ['BA', 120.6], ['CP', 4879.8], ['BH', 12]]))).toEqual(['BH'])
    expect(casesQuiDifferent(i, new Map([['AG', 5000.4], ['CP', 4879.8]]))).toEqual(['BA'])
    expect(casesQuiDifferent(i, new Map([['AG', 5000.4], ['BA', 120.6], ['CP', 4879.8], ['BH', 0]]))).toEqual([])
    // Dans l'ordre des codes, d'où qu'ils viennent : l'écran les énumère, et une liste qui suivrait l'ordre de lecture
    // changerait d'un affichage à l'autre.
    expect(casesQuiDifferent(i, new Map([['AG', 5000.41], ['BA', 120.6], ['CP', 4879.8], ['AA', 3]]))).toEqual(['AA', 'AG'])
  })
})
