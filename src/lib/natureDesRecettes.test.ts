import { describe, expect, it } from 'vitest'
import { MOTS_DE_LA_CAISSE, type CategorieDeLaCaisse } from './caisse'
import {
  CE_QUE_FAIT_LA_NATURE, categoriesDeLaNature, natureDite, phraseDeLaNature, refusDeLaNature,
} from './natureDesRecettes'
import { messagesSql } from '../test/raiseSql'
import { derniereDefinitionSql } from '../test/schema'

// LA NATURE DES RECETTES EN ESPÈCES DU CLIENT, À L'ÉCRAN DU CABINET (ligne 26.6, étape C11 ; CAISSE2-Q2, (B)). Ce qui se garde :
// la liste ne propose que ce que la garde admet, le refus est celui de la base, et une nature qu'on n'a pas pu juger ne se dit
// jamais « absente ». Données fictives.
const D = 'd1'
const CATEGORIES: CategorieDeLaCaisse[] = [
  { id: 'honoraires', dossier_id: D, libelle: 'Honoraires', compte_comptable: '706000' },
  { id: 'commune-7', dossier_id: null, libelle: 'Produits divers (commune)', compte_comptable: '758000' },
  { id: 'achats', dossier_id: D, libelle: 'Fournitures', compte_comptable: '606000' },
  { id: 'sans-compte', dossier_id: D, libelle: 'Sans compte', compte_comptable: null },
  { id: 'ailleurs', dossier_id: 'd2', libelle: 'Honoraires d’un autre dossier', compte_comptable: '706000' },
  { id: 'court', dossier_id: D, libelle: 'Compte trop court', compte_comptable: '70' },
]

describe('la nature des recettes du client', () => {
  it('la liste ne propose que les catégories de produit (classe 7) du dossier et les communes', () => {
    expect(categoriesDeLaNature(CATEGORIES, D).map((c) => c.id)).toEqual(['honoraires', 'commune-7'])
    expect(categoriesDeLaNature(CATEGORIES, 'd2').map((c) => c.id)).toEqual(['commune-7', 'ailleurs'])
    expect(categoriesDeLaNature([], D)).toEqual([])
  })

  it('le refus est celui de la garde, à la lettre ; nul retire la nature et passe', () => {
    expect(refusDeLaNature('honoraires', D, CATEGORIES)).toBeNull()
    expect(refusDeLaNature('commune-7', D, CATEGORIES)).toBeNull()
    expect(refusDeLaNature(null, D, CATEGORIES)).toBeNull()
    for (const id of ['achats', 'sans-compte', 'ailleurs', 'court', 'inconnue']) {
      expect(refusDeLaNature(id, D, CATEGORIES), id).toBe(MOTS_DE_LA_CAISSE.nature_hors_produit.gabarit)
    }
    expect(messagesSql(derniereDefinitionSql('garder_categorie_recettes_client'))).toEqual([MOTS_DE_LA_CAISSE.nature_hors_produit.gabarit])
    // Et la règle que la liste suit est celle de la garde : le dossier ou commune, un compte de classe 7 à trois chiffres.
    expect(derniereDefinitionSql('garder_categorie_recettes_client'))
      .toContain("where c.id = new.categorie_recettes_client and (c.dossier_id is null or c.dossier_id = new.id)\n                    and c.compte_comptable ~ '^7[0-9]{2}'")
  })

  it('la nature dite : fixée, absente, hors des produits, ou illisible — jamais « absente » sans l’avoir lue', () => {
    expect(natureDite('honoraires', D, CATEGORIES)).toEqual({ etat: 'fixee', libelle: 'Honoraires' })
    expect(natureDite(null, D, CATEGORIES)).toEqual({ etat: 'absente' })
    expect(natureDite('achats', D, CATEGORIES)).toEqual({ etat: 'hors_produit' })
    expect(natureDite('inconnue', D, CATEGORIES)).toEqual({ etat: 'hors_produit' })
    expect(natureDite(undefined, D, CATEGORIES)).toEqual({ etat: 'illisible' })
    expect(natureDite(null, D, null)).toEqual({ etat: 'illisible' })
    expect(natureDite('honoraires', D, null)).toEqual({ etat: 'illisible' })
  })

  it('chaque état a sa phrase, et la carte dit ce qu’un changement fait aux recettes déjà saisies', () => {
    const phrases = [
      phraseDeLaNature({ etat: 'fixee', libelle: 'Honoraires' }), phraseDeLaNature({ etat: 'absente' }),
      phraseDeLaNature({ etat: 'hors_produit' }), phraseDeLaNature({ etat: 'illisible' }),
    ]
    expect(new Set(phrases).size).toBe(4)
    expect(phrases[0]).toBe('Ses recettes en espèces se rangent sous « Honoraires ».')
    expect(phrases[1]).toContain('la base refuse les recettes en espèces que le client saisit')
    expect(phrases[3]).toContain('rien ne se change d’ici')
    expect(CE_QUE_FAIT_LA_NATURE).toContain('celles déjà saisies gardent la leur')
  })
})
