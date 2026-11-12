import { beforeEach, describe, expect, it, vi } from 'vitest'

// LE PDF DE LA 2035 DU PAQUET D'ARCHIVE (ligne 44, INAL3c) : rempli depuis l'instantané validé par le code de Clôture.
// remplir2035.ts charge pdf.js, qui touche au DOM dès l'import : il est simulé, et l'on voit ce qu'il reçoit.
const faux = vi.hoisted(() => ({
  appels: [] as unknown[][],
  leve: null as Error | null,
  sansAncrage: [] as string[],
}))

vi.mock('./remplir2035', () => ({
  remplir2035: async (...args: unknown[]) => {
    faux.appels.push(args)
    if (faux.leve) throw faux.leve
    return { pdf: new TextEncoder().encode('%PDF'), codesSansAncrage: faux.sansAncrage, codesSansAncrage2035E: [] }
  },
}))

import { la2035DuPaquet } from './paquetDArchive2035'
import { avertissementDuFormulaire } from './modeles2035'

function instantane(annee: number) {
  return {
    version: 2, annee,
    cases: { AG: 1200.4, BR: 300.2 }, formulaire: { AG: 1200, BR: 300 },
    totalRecettes: 1200.4, totalDepenses: 300.2, resultat: 900.2,
    postes: [{ poste: 'Honoraires', nature: 'recette', montant: 1200.4, nbPieces: 0, nbMouvements: 3, nbEncaissements: 0 }],
    entete: { nom: 'Praticien fictif', activite: 'Infirmier', siret: '12345678900012' },
  }
}

beforeEach(() => {
  faux.appels = []
  faux.leve = null
  faux.sansAncrage = []
})

describe('le PDF de la 2035 validée, pour le paquet d’archive', () => {
  it('se remplit des cases FIGÉES du formulaire et du déclarant de l’instantané, sans annexe, sur l’exercice', async () => {
    const r = await la2035DuPaquet(instantane(2025), 2025)
    expect(r).toMatchObject({ etat: 'rempli', casesNonPlacees: [], avertissement: null })
    expect(faux.appels).toHaveLength(1)
    const [valeurs, entete, annexe, annee] = faux.appels[0]
    expect([...(valeurs as Map<string, number>)]).toEqual([['AG', 1200], ['BR', 300]])
    expect(entete).toEqual({ nom: 'Praticien fictif', activite: 'Infirmier', siret: '12345678900012' })
    expect(annexe).toBeNull()
    expect(annee).toBe(2025)
  })

  it('un millésime absent : l’avertissement de 2035S-Q5, et les cases non placées, rendus pour le manifeste', async () => {
    faux.sansAncrage = ['BT']
    const r = await la2035DuPaquet(instantane(2026), 2026)
    expect(avertissementDuFormulaire(2026)).not.toBeNull()
    expect(r).toMatchObject({ etat: 'rempli', casesNonPlacees: ['BT'], avertissement: avertissementDuFormulaire(2026) })
  })

  it('sans instantané lisible, ou d’un autre exercice, aucun remplissage : un motif', async () => {
    expect(await la2035DuPaquet(null, 2025)).toEqual({ etat: 'impossible', motif: 'la validation de l’exercice n’a figé aucune 2035' })
    expect(await la2035DuPaquet({ AG: 1200 }, 2025)).toMatchObject({ etat: 'impossible', motif: expect.stringContaining('sait relire') })
    expect(await la2035DuPaquet(instantane(2024), 2025)).toMatchObject({ etat: 'impossible', motif: expect.stringContaining('2024') })
    expect(faux.appels).toHaveLength(0)
  })

  it('un modèle introuvable ou illisible ne lève pas : son motif', async () => {
    faux.leve = new Error('Formulaire 2035 introuvable (404)')
    expect(await la2035DuPaquet(instantane(2025), 2025)).toEqual({ etat: 'impossible', motif: 'Formulaire 2035 introuvable (404)' })
  })
})
