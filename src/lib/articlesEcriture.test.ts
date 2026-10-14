import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enregistrerArticle, reprendreArticle, retirerArticle } from './articlesEcriture'
import type { SaisieEnvoyee } from './articlesVue'
import { article } from '../test/articles'
import type { Article } from './types'

// LES TROIS GESTES D'UN ARTICLE (espace client, étape A2a). Ce que ces cas gardent : chaque geste n'appelle que SA fonction
// de la base, avec ses arguments ; le refus de la base se lève sous ses mots ; une réponse qui n'est pas l'article visé (ou
// pas dans l'état attendu) est une panne dite, jamais un succès supposé.

const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; params: Record<string, unknown> }[],
  reponse: { data: null, error: null } as { data: unknown; error: { message: string } | null },
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (nom: string, params: Record<string, unknown>) => {
      faux.appels.push({ nom, params })
      return Promise.resolve(faux.reponse)
    },
  },
}))

const SAISIE: SaisieEnvoyee = {
  designation: 'Article neuf', description: null, reference: null, unite: 'C62', prix_unitaire_ht: 12.5, taux_tva: 20, nature: 'services',
}
const RETIRE = '2027-10-05T08:00:00Z'

beforeEach(() => {
  faux.appels = []
  faux.reponse = { data: null, error: null }
})

describe('enregistrerArticle', () => {
  it('crée : sa fonction, le dossier, aucun identifiant, la saisie entière', async () => {
    faux.reponse = { data: article({ id: 'nouveau' }), error: null }
    const ecrit: Article = await enregistrerArticle('d1', null, SAISIE)
    expect(ecrit.id).toBe('nouveau')
    expect(faux.appels).toEqual([{ nom: 'enregistrer_article', params: { p_dossier_id: 'd1', p_article_id: null, p_article: SAISIE } }])
  })

  it('modifie : l’identifiant de l’article visé, et la base doit rendre CET article', async () => {
    faux.reponse = { data: article({ id: 'a1' }), error: null }
    await enregistrerArticle('d1', 'a1', SAISIE)
    expect(faux.appels[0].params.p_article_id).toBe('a1')
    faux.reponse = { data: article({ id: 'a2' }), error: null }
    await expect(enregistrerArticle('d1', 'a1', SAISIE)).rejects.toThrow('La base n’a pas rendu l’article écrit')
  })

  it('le refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: 'Cet article est retiré : le reprendre avant de le modifier.' } }
    await expect(enregistrerArticle('d1', 'a1', SAISIE)).rejects.toThrow('Cet article est retiré : le reprendre avant de le modifier.')
  })

  it.each([[null], [undefined], ['texte'], [{}], [{ id: 12 }]])('une réponse qui n’est pas une ligne d’article (%j) est une panne dite', async (data) => {
    faux.reponse = { data, error: null }
    await expect(enregistrerArticle('d1', null, SAISIE)).rejects.toThrow('La base n’a pas rendu l’article écrit')
  })

  it('une écriture qui rend un article RETIRÉ n’est pas celle qu’on a demandée', async () => {
    faux.reponse = { data: article({ id: 'a1', retire_le: RETIRE }), error: null }
    await expect(enregistrerArticle('d1', 'a1', SAISIE)).rejects.toThrow('La base n’a pas rendu l’article écrit')
  })
})

describe('retirerArticle', () => {
  it('sa fonction, le dossier, l’article ; la base rend l’article retiré', async () => {
    faux.reponse = { data: article({ id: 'a1', retire_le: RETIRE, retire_par: 'u' }), error: null }
    const ecrit = await retirerArticle('d1', 'a1')
    expect(ecrit.retire_le).toBe(RETIRE)
    expect(faux.appels).toEqual([{ nom: 'retirer_article', params: { p_dossier_id: 'd1', p_article_id: 'a1' } }])
  })

  it('un article rendu NON retiré, ou un autre article, est une panne dite', async () => {
    faux.reponse = { data: article({ id: 'a1' }), error: null }
    await expect(retirerArticle('d1', 'a1')).rejects.toThrow('La base n’a pas rendu l’article écrit')
    faux.reponse = { data: article({ id: 'a9', retire_le: RETIRE }), error: null }
    await expect(retirerArticle('d1', 'a1')).rejects.toThrow('La base n’a pas rendu l’article écrit')
  })

  it('le refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: 'Cet article est déjà retiré.' } }
    await expect(retirerArticle('d1', 'a1')).rejects.toThrow('Cet article est déjà retiré.')
  })
})

describe('reprendreArticle', () => {
  it('sa fonction, le dossier, l’article ; la base rend l’article repris', async () => {
    faux.reponse = { data: article({ id: 'a1', modifie_par: 'u', modifie_le: RETIRE }), error: null }
    const ecrit = await reprendreArticle('d1', 'a1')
    expect(ecrit.retire_le).toBeNull()
    expect(faux.appels).toEqual([{ nom: 'reprendre_article', params: { p_dossier_id: 'd1', p_article_id: 'a1' } }])
  })

  it('un article rendu encore retiré est une panne dite', async () => {
    faux.reponse = { data: article({ id: 'a1', retire_le: RETIRE }), error: null }
    await expect(reprendreArticle('d1', 'a1')).rejects.toThrow('La base n’a pas rendu l’article écrit')
  })

  it('le refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: "Cet article n'est pas retiré." } }
    await expect(reprendreArticle('d1', 'a1')).rejects.toThrow("Cet article n'est pas retiré.")
  })
})
