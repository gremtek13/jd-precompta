// Deux clés étrangères relient `facture_lignes` à `factures_emises` depuis l'acompte d'un devis (`facture_id`, et
// `reprise_facture_id`) : PostgREST refuse alors un embarquement qui ne nomme pas sa relation (« more than one
// relationship was found »), et la lecture rend zéro ligne avec une erreur — la 2035 ne se calculait plus (constaté
// en production le 16/11/2026). Toute lecture des lignes d'une facture qui embarque sa facture nomme donc la clé.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return fichiers(chemin)
    return /\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom) ? [chemin] : []
  })
}

describe('les lignes d’une facture embarquent leur facture par une relation nommée', () => {
  const sites = fichiers('src').flatMap((chemin) =>
    readFileSync(chemin, 'utf8').split('\n')
      // Une liste de colonnes de `facture_lignes` : elle porte `prix_unitaire_ht` et embarque `factures_emises`.
      .filter((ligne) => ligne.includes('prix_unitaire_ht') && /factures_emises(![a-z_]+)*\(/.test(ligne))
      .map((ligne) => ({ chemin, ligne })))

  it('voit les lectures connues (un plancher : zéro site serait un scanner aveugle)', () => {
    expect(sites.length).toBeGreaterThanOrEqual(5)
  })

  it('n’en laisse aucune sans le nom de la clé `facture_lignes_facture_id_fkey`', () => {
    const fautes = sites.filter((s) => !s.ligne.includes('factures_emises!facture_lignes_facture_id_fkey!inner('))
    expect(fautes.map((s) => `${s.chemin} : ${s.ligne.trim()}`)).toEqual([])
  })
})
