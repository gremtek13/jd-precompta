import { describe, expect, it } from 'vitest'
import { correspondALaRecherche, normaliserPourRecherche } from './recherche'

describe('normaliserPourRecherche', () => {
  it('retire les accents et la casse', () => {
    expect(normaliserPourRecherche('Relevé Bancaire ÉCHÉANCE')).toBe('releve bancaire echeance')
    expect(normaliserPourRecherche('Août')).toBe('aout')
  })

  it('ramène la virgule décimale au point', () => {
    // Repris de la recherche de BanqueTab : on tape un montant à la française.
    expect(normaliserPourRecherche('192,00')).toBe('192.00')
  })
})

describe('correspondALaRecherche', () => {
  it('trouve un mot accentué en le tapant sans accent', () => {
    // Le défaut des deux recherches artisanales qu'elle remplace : « releve » ne trouvait pas
    // « Relevé », donc l'écran répondait « rien » sur une liste qui contenait la ligne cherchée.
    expect(correspondALaRecherche(['Relevé janvier.pdf'], 'releve')).toBe(true)
    expect(correspondALaRecherche(['Relevé janvier.pdf'], 'RELEVE')).toBe(true)
    // Et l'inverse : taper l'accent doit trouver un contenu sans accent.
    expect(correspondALaRecherche(['Releve janvier.pdf'], 'relevé')).toBe(true)
  })

  it('exige tous les mots, dans n’importe quel ordre et n’importe quel champ', () => {
    const ligne = ['Facture EDF.pdf', 'EDF', 'janvier 2023']
    expect(correspondALaRecherche(ligne, 'edf janvier')).toBe(true)
    expect(correspondALaRecherche(ligne, 'janvier edf')).toBe(true)
    expect(correspondALaRecherche(ligne, 'edf orange')).toBe(false)
  })

  it('trouve un montant tapé avec ou sans décimales, virgule ou point', () => {
    expect(correspondALaRecherche(['Transmedical', 192], '192')).toBe(true)
    expect(correspondALaRecherche(['Transmedical', 192], '192,00')).toBe(true)
    expect(correspondALaRecherche(['Transmedical', 192], '192.00')).toBe(true)
    expect(correspondALaRecherche(['Transmedical', 192], '193')).toBe(false)
  })

  it('laisse tout passer quand la recherche est vide', () => {
    // Sinon un champ vide masquerait la liste entière — le contraire de ce qu'on attend.
    expect(correspondALaRecherche(['quoi que ce soit'], '')).toBe(true)
    expect(correspondALaRecherche(['quoi que ce soit'], '   ')).toBe(true)
  })

  it('ignore les champs absents plutôt que de les rendre cherchables', () => {
    // Sans ce filtrage, taper « null » remonterait toutes les lignes dont un champ est vide.
    expect(correspondALaRecherche(['EDF', null, undefined, ''], 'null')).toBe(false)
    expect(correspondALaRecherche(['EDF', null], 'undefined')).toBe(false)
    expect(correspondALaRecherche(['EDF', null], 'edf')).toBe(true)
  })

  it('ne fait pas correspondre un terme à cheval sur deux champs', () => {
    // « Aucune » ligne ne doit ressortir parce que la fin d'un champ et le début du suivant, collés,
    // forment le mot cherché.
    expect(correspondALaRecherche(['abc', 'def'], 'abcdef')).toBe(false)
    expect(correspondALaRecherche(['abcdef'], 'abcdef')).toBe(true)
  })

  it('trouve une date au format affiché comme au format ISO', () => {
    expect(correspondALaRecherche(['2023-06-30', '30/06/2023'], '30/06')).toBe(true)
    expect(correspondALaRecherche(['2023-06-30', '30/06/2023'], '2023-06')).toBe(true)
  })

  it('traite zéro comme une valeur cherchable, pas comme un champ vide', () => {
    // Piège classique du filtrage par falsy : un montant à 0 disparaîtrait de la recherche.
    expect(correspondALaRecherche(['Avoir', 0], '0.00')).toBe(true)
  })
})
