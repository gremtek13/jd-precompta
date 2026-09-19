import { describe, expect, it } from 'vitest'
import { classeDuCompte, controlerBalance, lireBalance } from './balanceImport'
import { parseCsv } from './csv'

// Balances reconstruites, jamais copiées d'un export réel : ce qu'on teste est la STRUCTURE (un
// numéro de compte du PCG, deux colonnes de montants), pas le contenu d'un dossier.
const BALANCE_AVEC_ENTETE = `Compte;Libellé;Débit;Crédit
401000;Fournisseurs;0,00;1 250,00
512000;Banque;3 400,50;0,00
606100;Achats non stockés;1 250,00;0,00
706000;Prestations de services;0,00;3 400,50
TOTAUX;;4 650,50;4 650,50`

describe('lireBalance', () => {
  it('lit une balance avec en-tête', () => {
    const r = lireBalance(parseCsv(BALANCE_AVEC_ENTETE))
    expect(r.lignes).toHaveLength(4)
    expect(r.lignes[0]).toEqual({ compte: '401000', libelle: 'Fournisseurs', debit: 0, credit: 1250 })
    expect(r.lignes[1]).toEqual({ compte: '512000', libelle: 'Banque', debit: 3400.5, credit: 0 })
  })

  it("écarte l'en-tête et la ligne de totaux, et dit pourquoi", () => {
    // « TOTAUX » porte des montants mais pas de numéro de compte : l'inclure doublerait la balance
    // et ferait passer un fichier parfait pour un fichier en écart.
    const r = lireBalance(parseCsv(BALANCE_AVEC_ENTETE))
    expect(r.ignorees.map((i) => i.motif)).toEqual(['aucun numéro de compte', 'aucun numéro de compte'])
    expect(r.ignorees[1].ligne[0]).toBe('TOTAUX')
  })

  it('lit une balance SANS en-tête, sur la seule structure', () => {
    // Aucun mot ne dit « débit » : c'est le numéro de compte qui identifie sa colonne, et la
    // position qui départage les deux colonnes de montants.
    const r = lireBalance(parseCsv('401000;Fournisseurs;0,00;1250,00\n512000;Banque;1250,00;0,00\n606100;Achats;500,00;500,00'))
    expect(r.lignes).toHaveLength(3)
    expect(r.lignes[0]).toMatchObject({ compte: '401000', debit: 0, credit: 1250 })
  })

  it("l'en-tête l'emporte sur la position quand les colonnes sont inversées", () => {
    // Certains exports présentent Crédit avant Débit. Seul un en-tête peut le dire — deux colonnes
    // de nombres positifs de même nature ne se distinguent par aucun autre signal.
    const r = lireBalance(parseCsv('Compte;Libellé;Crédit;Débit\n401000;Fournisseurs;1250,00;0,00'))
    expect(r.lignes[0]).toMatchObject({ debit: 0, credit: 1250 })
  })

  it('accepte « Solde débiteur » / « Solde créditeur » comme en-têtes', () => {
    const r = lireBalance(parseCsv('Compte;Libellé;Solde débiteur;Solde créditeur\n512000;Banque;3400,50;0,00'))
    expect(r.lignes[0]).toMatchObject({ debit: 3400.5, credit: 0 })
  })

  it('choisit la colonne de comptes qui en porte le PLUS, pas la première venue', () => {
    // Une colonne « numéro de pièce » peut porter par hasard une valeur qui a l'air d'un compte ;
    // elle n'en portera pas sur toutes les lignes.
    const r = lireBalance(parseCsv('101;Pièce;401000;Fournisseurs;0,00;1250,00\nAB12;Pièce;512000;Banque;1250,00;0,00\nCD34;Pièce;606100;Achats;10,00;10,00'))
    expect(r.colonnes?.compte).toBe(2)
    expect(r.lignes.map((l) => l.compte)).toEqual(['401000', '512000', '606100'])
  })

  it("dit « aucun numéro de compte » plutôt que de rendre une balance vide", () => {
    // Un relevé bancaire déposé par erreur dans l'import de balance : la distinction compte, parce
    // qu'une liste vide se lirait « balance vide », ce qui n'est pas la même information.
    const r = lireBalance(parseCsv('Date;Libellé;Montant\n01/03/2025;Virement;1250,00'))
    expect(r.lignes).toEqual([])
    expect(r.colonnes).toBeNull()
    expect(r.ignorees).toHaveLength(2)
    expect(r.ignorees[0].motif).toBe('aucun numéro de compte')
  })

  it('écarte une ligne de compte dont aucun montant n\'est lisible', () => {
    const r = lireBalance(parseCsv('401000;Fournisseurs;0,00;1250,00\n512000;Banque;1250,00;0,00\n455000;Compte courant;;\n606100;Achats;10,00;10,00'))
    expect(r.lignes.map((l) => l.compte)).toEqual(['401000', '512000', '606100'])
    expect(r.ignorees.map((i) => i.motif)).toEqual(['aucun montant lisible'])
  })

  it('refuse un numéro de compte hors classes 1 à 8', () => {
    // La classe 9 est libre (comptabilité analytique) et « 0… » n'existe pas au PCG : les accepter
    // ferait entrer des codes analytiques dans une balance générale.
    const r = lireBalance(parseCsv('901000;Analytique;10,00;0,00\n012000;Inconnu;10,00;0,00\n401000;Fournisseurs;0,00;20,00\n512000;Banque;20,00;0,00\n606100;Achats;5,00;5,00'))
    expect(r.lignes.map((l) => l.compte)).toEqual(['401000', '512000', '606100'])
  })

  it("ne prend pour en-tête que les cinq premières lignes", () => {
    // Un pied de section qui réécrit « Crédit »/« Débit » plus bas dans le fichier n'est pas un
    // en-tête : le lire comme tel inverserait les deux colonnes sur TOUTE la balance, en silence.
    const lignes = [
      '401000;Fournisseurs;0,00;1250,00',
      '512000;Banque;1250,00;0,00',
      '606100;Achats;10,00;0,00',
      '607000;Achats bis;0,00;10,00',
      '613000;Loyers;5,00;0,00',
      '706000;Prestations;0,00;5,00',
      ';;Crédit;Débit',
    ].join('\n')
    const r = lireBalance(parseCsv(lignes))
    expect(r.lignes[0]).toMatchObject({ compte: '401000', debit: 0, credit: 1250 })
  })

  it("ne prend jamais une colonne de montants pour le libellé", () => {
    // Beaucoup d'exports écrivent « - » au lieu de zéro : cette colonne porte alors du texte non
    // numérique, et sans exclusion explicite elle battrait un libellé peu rempli. Le tableau
    // afficherait « - » en guise d'intitulé de compte.
    const lignes = [
      '401000;Fournisseurs;-;1250,00',
      '512000;;1250,00;0,00',
      '606100;;-;10,00',
      '706000;;10,00;0,00',
    ].join('\n')
    const r = lireBalance(parseCsv(lignes))
    expect(r.lignes.map((l) => l.libelle)).toEqual(['Fournisseurs', '', '', ''])
  })

  it("n'analyse PAS les montants avec une expression régulière à lui", () => {
    // parseMontantBancaire est le seul analyseur du projet : « 1.234,56 » vaut 1234,56 et non 1,23.
    const r = lireBalance(parseCsv('606100;Achats;1.234,56;0,00\n401000;Fournisseurs;0,00;1.234,56\n512000;Banque;0,01;0,01'))
    expect(r.lignes[0].debit).toBe(1234.56)
  })

  it('rend un libellé vide plutôt que de se tromper de colonne quand il n\'y en a pas', () => {
    const r = lireBalance(parseCsv('401000;0,00;1250,00\n512000;1250,00;0,00\n606100;10,00;10,00'))
    expect(r.lignes.every((l) => l.libelle === '')).toBe(true)
  })
})

describe('controlerBalance', () => {
  it('confirme une balance équilibrée', () => {
    const r = controlerBalance(lireBalance(parseCsv(BALANCE_AVEC_ENTETE)).lignes)
    expect(r).toEqual({ totalDebit: 4650.5, totalCredit: 4650.5, ecart: 0, equilibree: true })
  })

  it("chiffre l'écart d'une balance amputée", () => {
    // Une balance qui ne boucle pas n'est pas une balance : c'est un fichier incomplet, et le
    // cabinet doit l'apprendre avant d'adosser une comptabilité dessus.
    const r = controlerBalance([
      { compte: '401000', libelle: '', debit: 0, credit: 1250 },
      { compte: '512000', libelle: '', debit: 900, credit: 0 },
    ])
    expect(r.ecart).toBe(-350)
    expect(r.equilibree).toBe(false)
  })

  it('absorbe un centime d\'arrondi, jamais un vrai déséquilibre', () => {
    expect(controlerBalance([
      { compte: '401000', libelle: '', debit: 100.01, credit: 0 },
      { compte: '512000', libelle: '', debit: 0, credit: 100 },
    ]).equilibree).toBe(true)
    expect(controlerBalance([
      { compte: '401000', libelle: '', debit: 100.02, credit: 0 },
      { compte: '512000', libelle: '', debit: 0, credit: 100 },
    ]).equilibree).toBe(false)
  })

  it("n'annonce pas un écart né de l'addition de flottants", () => {
    // 0,1 + 0,2 ≠ 0,3 en binaire : sur une balance de plusieurs centaines de lignes, l'écart
    // affiché serait un artefact de représentation plutôt qu'un fait comptable.
    const lignes = Array.from({ length: 300 }, (_, i) => ({
      compte: '606100', libelle: '', debit: i % 2 === 0 ? 0.1 : 0.2, credit: i % 2 === 0 ? 0.2 : 0.1,
    }))
    expect(controlerBalance(lignes).ecart).toBe(0)
  })

  it('rend des zéros sur une balance vide', () => {
    expect(controlerBalance([])).toEqual({ totalDebit: 0, totalCredit: 0, ecart: 0, equilibree: true })
  })
})

describe('classeDuCompte', () => {
  it('rend le premier chiffre du numéro', () => {
    expect(classeDuCompte('606100')).toBe(6)
    expect(classeDuCompte('706000')).toBe(7)
    expect(classeDuCompte(' 401000 ')).toBe(4)
  })

  it('refuse ce qui n\'est pas un numéro de compte', () => {
    expect(classeDuCompte('901000')).toBeNull()
    expect(classeDuCompte('40')).toBeNull()
    expect(classeDuCompte('TOTAUX')).toBeNull()
  })
})
