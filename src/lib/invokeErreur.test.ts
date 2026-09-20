import { describe, expect, it } from 'vitest'
import { extraireErreurFonction } from './invokeErreur'

// Le point de passage UNIQUE de tous les messages d'erreur d'Edge Function de l'application —
// treize appels y mènent — et il n'avait aucun test.
//
// Ce qui rend l'absence coûteuse : une régression ici ne casse rien visiblement. Elle fait
// simplement retomber chaque écran sur son message de repli, qui est plausible. C'est mot pour mot
// le défaut que cette fonction a été écrite pour corriger (« Le SIRET de l'émetteur est manquant »
// affiché en « Une erreur est survenue »), et il avait vécu depuis le début du projet sans que
// personne le voie.
//
// `invokeErreur.ts` n'importe pas `supabase.ts`, donc aucun faux client n'est nécessaire : la
// fonction se teste avec de vraies `Response`, comme celles que `FunctionsHttpError` transporte.

const erreurAvecCorps = (corps: unknown, statut = 400) =>
  ({ context: new Response(JSON.stringify(corps), { status: statut }) })

describe('extraireErreurFonction', () => {
  // LA RAISON D'ÊTRE DE LA FONCTION. supabase-js lève avant d'avoir lu le corps, donc `data` est nul
  // et le vrai message n'existe que dans `error.context`.
  it('rend le message que la fonction Edge a réellement répondu', async () => {
    const e = erreurAvecCorps({ error: "Le SIRET de l'émetteur est manquant." })
    expect(await extraireErreurFonction(e, 'repli')).toBe("Le SIRET de l'émetteur est manquant.")
  })

  it('retombe sur le repli quand le corps JSON ne porte pas de champ `error`', async () => {
    expect(await extraireErreurFonction(erreurAvecCorps({ message: 'ailleurs' }), 'repli')).toBe('repli')
  })

  // `typeof === 'string'` et pas seulement la présence du champ : un `error` numérique ou objet
  // rendu tel quel afficherait « [object Object] » à l'utilisateur.
  it("refuse un champ `error` qui n'est pas une chaîne", async () => {
    expect(await extraireErreurFonction(erreurAvecCorps({ error: 500 }), 'repli')).toBe('repli')
    expect(await extraireErreurFonction(erreurAvecCorps({ error: { code: 'x' } }), 'repli')).toBe('repli')
  })

  // Le cas que le `try/catch` du code garde : une passerelle qui répond du HTML, un timeout de la
  // plateforme. `.json()` lève alors, et la fonction ne doit pas emporter l'écran avec elle.
  it('survit à un corps qui n’est pas du JSON', async () => {
    const e = { context: new Response('<html>504 Gateway Timeout</html>', { status: 504 }) }
    expect(await extraireErreurFonction(e, 'Service indisponible.')).toBe('Service indisponible.')
  })

  // UNE RESPONSE NE SE LIT QU'UNE FOIS. Le commentaire du module insiste sur « la Response brute,
  // jamais consommée à ce stade » ; si elle l'a été, `.json()` lève — et c'est justement ce que le
  // `catch` doit absorber plutôt que de propager.
  it('survit à une Response déjà consommée', async () => {
    const reponse = new Response(JSON.stringify({ error: 'perdu' }), { status: 400 })
    await reponse.text()
    expect(await extraireErreurFonction({ context: reponse }, 'repli')).toBe('repli')
  })

  it('utilise le message d’une Error ordinaire quand il n’y a pas de contexte', async () => {
    expect(await extraireErreurFonction(new Error('réseau coupé'), 'repli')).toBe('réseau coupé')
  })

  // Une `Error` sans message ne doit pas rendre la chaîne vide : un écran afficherait alors une
  // zone d'erreur muette, ce qui est pire qu'un repli générique.
  it('préfère le repli à une Error au message vide', async () => {
    expect(await extraireErreurFonction(new Error(''), 'repli')).toBe('repli')
  })

  it('retombe sur le repli sur tout ce qui n’est ni contexte ni Error', async () => {
    for (const e of [null, undefined, 'une chaîne', 42, { context: 'pas une Response' }]) {
      expect(await extraireErreurFonction(e, 'repli'), String(e)).toBe('repli')
    }
  })

  // LE PARAMÈTRE PAR DÉFAUT, qu'aucun appelant de test n'exerçait — c'est l'angle mort que
  // CLAUDE.md nomme (« quand une fonction testée a une valeur par défaut, elle mérite son propre
  // test »), et ici il n'y avait même pas de test du tout.
  it('a un repli par défaut, en français et non vide', async () => {
    const message = await extraireErreurFonction(null)
    expect(message).toBe('Une erreur est survenue.')
  })

  // Le contexte l'emporte sur le message de l'Error : `FunctionsHttpError` porte les deux, et son
  // propre message ne dit que « Edge Function returned a non-2xx status code ».
  it('préfère le corps de la réponse au message de l’Error qui la porte', async () => {
    const e = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'Plafond de coût atteint.' }), { status: 402 }),
    })
    expect(await extraireErreurFonction(e, 'repli')).toBe('Plafond de coût atteint.')
  })
})
