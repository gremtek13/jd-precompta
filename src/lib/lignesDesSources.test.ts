import { describe, expect, it } from 'vitest'
import { lignesDeLaSource, lignesDesSources, type LigneDuBrouillon } from './ecritureVenteFacturee'
import type { SourceEcritureVente } from './ecrituresVentesFacturees'
import { entierTire, tirage } from '../test/encaissementsBatterie'

// L'INDEX DES LIGNES D'UNE SOURCE (le banc de charge, 07/11/2026) : `lignesDesSources` indexe le brouillon une fois, là où
// `lignesDeLaSource`, gardée telle quelle, le filtre pour chaque source. Les deux formes se confrontent sur des brouillons
// tirés d'une graine fixe — deux dossiers, des identifiants pris dans un petit réservoir commun pour qu'ils se croisent
// d'un champ à l'autre, des champs nuls ou non —, et sur des sources de chaque genre, présentes ou non : mêmes lignes,
// même ordre, mêmes objets.

const D1 = 'd-1'
const D2 = 'd-2'

function jeu(graine: number, nbLignes: number) {
  const suivant = tirage(graine)
  const entier = (n: number) => entierTire(suivant, n)
  const id = (reservoir: number) => `x-${entier(reservoir)}`
  // Un champ nul la plupart du temps, sinon un identifiant du réservoir commun à tous les champs.
  const peutEtre = (probabilite: number): string | null => (suivant() < probabilite ? id(40) : null)
  const brouillon: LigneDuBrouillon[] = []
  for (let i = 0; i < nbLignes; i++) {
    brouillon.push({
      dossier_id: suivant() < 0.85 ? D1 : D2,
      statut: suivant() < 0.7 ? 'proposee' : 'validee',
      facture_id: peutEtre(0.3),
      encaissement_id: peutEtre(0.3),
      ligne_bancaire_id: peutEtre(0.5),
      piece_id: peutEtre(0.1),
      immobilisation_id: peutEtre(0.03),
      vehicule_id: peutEtre(0.03),
      declaration_tva_id: peutEtre(0.03),
      cotisation_id: peutEtre(0.03),
    })
  }
  const sources: SourceEcritureVente[] = []
  for (let i = 0; i < 4 * 50; i++) {
    const cible = id(50) // dix identifiants que le brouillon ne porte jamais
    const genre = i % 4
    sources.push(genre === 0 ? { genre: 'facture', factureId: cible }
      : genre === 1 ? { genre: 'avoir', factureId: cible }
        : genre === 2 ? { genre: 'encaissement', encaissementId: cible, factureId: id(40) }
          : { genre: 'mouvement', ligneBancaireId: cible })
  }
  return { brouillon, sources }
}

describe('lignesDesSources rend, pour chaque source, ce que rend lignesDeLaSource', () => {
  for (const [graine, nbLignes] of [[1, 0], [7, 50], [2026, 3000], [99, 12000]] as const) {
    it(`graine ${graine}, ${nbLignes} lignes`, () => {
      const { brouillon, sources } = jeu(graine, nbLignes)
      for (const dossierId of [D1, D2, 'd-absent']) {
        const lignesDe = lignesDesSources(brouillon, dossierId)
        let nonVides = 0
        for (const source of sources) {
          const attendues = lignesDeLaSource(brouillon, source, dossierId)
          const rendues = lignesDe(source)
          expect(rendues).toEqual(attendues)
          // Les mêmes objets, dans le même ordre : l'écran lit ensuite leurs champs.
          expect(rendues.every((l, i) => l === attendues[i])).toBe(true)
          if (attendues.length > 0) nonVides++
        }
        // Le jeu n'est pas aveugle : sur un grand brouillon du premier dossier, chaque genre trouve des lignes.
        if (dossierId === D1 && nbLignes >= 3000) {
          expect(nonVides).toBeGreaterThan(sources.length / 2)
          for (const genre of ['facture', 'avoir', 'encaissement', 'mouvement']) {
            expect(sources.some((s) => s.genre === genre && lignesDe(s).length > 0)).toBe(true)
          }
        }
      }
    })
  }

  it('rend un tableau neuf à chaque lecture : le modifier ne touche pas l’index', () => {
    const { brouillon, sources } = jeu(5, 500)
    const lignesDe = lignesDesSources(brouillon, D1)
    const source = sources.find((s) => lignesDe(s).length > 0)!
    const avant = lignesDe(source)
    lignesDe(source).length = 0
    expect(lignesDe(source)).toEqual(avant)
  })
})
