import { afterEach, describe, expect, it, vi } from 'vitest'
import { rechercherCodeNaf } from './sirene'

// `fetch` est remplacé plutôt que réellement appelé : l'API publique recherche-entreprises.api.gouv.fr
// n'est pas joignable depuis la CI, et un test qui dépend d'un service tiers échoue un jour pour une
// raison qui n'a rien à voir avec le code.
function repondre(corps: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => corps }))
}

afterEach(() => vi.unstubAllGlobals())

describe('rechercherCodeNaf', () => {
  it('lit le code et son libellé', async () => {
    repondre({ results: [{ activite_principale: '86.90D', libelle_activite_principale: 'Activités des infirmiers' }] })
    expect(await rechercherCodeNaf('12345678901234')).toEqual({ codeNaf: '86.90D', libelleNaf: 'Activités des infirmiers' })
  })

  it('accepte un SIRET saisi avec des espaces', async () => {
    repondre({ results: [{ activite_principale: '86.90D' }] })
    await rechercherCodeNaf('123 456 789 01234')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('12345678901234'))
  })

  it('n’appelle même pas l’API si le SIRET n’a pas 14 chiffres', async () => {
    repondre({ results: [] })
    expect(await rechercherCodeNaf('123456789')).toBeNull() // un SIREN, pas un SIRET
    expect(await rechercherCodeNaf('')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cherche le code sur le siège à défaut de la racine', async () => {
    // Plusieurs noms de champ selon la version de l'API — d'où les replis successifs.
    repondre({ results: [{ siege: { activite_principale: '86.90D', libelle_activite_principale: 'Infirmiers' } }] })
    expect(await rechercherCodeNaf('12345678901234')).toEqual({ codeNaf: '86.90D', libelleNaf: 'Infirmiers' })
  })

  it('rend le code seul quand l’API ne donne aucun libellé', async () => {
    // Jamais deviné : un même code NAF (86.90D) recouvre plusieurs professions paramédicales.
    repondre({ results: [{ activite_principale: '86.90D' }] })
    expect(await rechercherCodeNaf('12345678901234')).toEqual({ codeNaf: '86.90D', libelleNaf: null })
  })

  it('rend null sans jamais lever, quoi que réponde le réseau', async () => {
    // Best-effort assumé : ça ne doit jamais empêcher de créer ou consulter un dossier.
    repondre({ results: [] })
    expect(await rechercherCodeNaf('12345678901234')).toBeNull()

    repondre({}, false) // HTTP 4xx/5xx
    expect(await rechercherCodeNaf('12345678901234')).toBeNull()

    repondre({ results: [{ nom: 'Sans code NAF' }] })
    expect(await rechercherCodeNaf('12345678901234')).toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau indisponible')))
    await expect(rechercherCodeNaf('12345678901234')).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('JSON invalide') } }))
    await expect(rechercherCodeNaf('12345678901234')).resolves.toBeNull()
  })
})
