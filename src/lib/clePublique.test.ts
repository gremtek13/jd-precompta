import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { verifierClePublique } from './clePublique'

// La clé servie au navigateur : la publishable, jamais l'historique, jamais la secrète (voir
// `clePublique.ts`). Le calcul d'un côté, le câblage de l'autre — un contrôle parfait que
// `supabase.ts` n'appellerait plus ne garderait rien.

const racine = (chemin: string) => new URL(`../../${chemin}`, import.meta.url)

/** La valeur d'une variable dans un fichier `.env`. */
function valeurDans(fichier: string, variable: string): string | undefined {
  return readFileSync(racine(fichier), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${variable}=`))
    ?.slice(variable.length + 1)
}

describe('verifierClePublique', () => {
  it('rend une clé publishable telle quelle', () => {
    expect(verifierClePublique('sb_publishable_essai')).toBe('sb_publishable_essai')
  })

  it('refuse une clé absente, en nommant la variable', () => {
    expect(() => verifierClePublique(undefined)).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY doit être définie/)
    expect(() => verifierClePublique('')).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY doit être définie/)
  })

  it('refuse une clé secrète, et dit pourquoi', () => {
    expect(() => verifierClePublique('sb_secret_essai')).toThrow(/SECRÈTE/)
  })

  it('refuse la clé historique « anon », qui cesse de fonctionner fin 2026', () => {
    expect(() => verifierClePublique('eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature')).toThrow(/historique/)
    expect(() => verifierClePublique('sb_publishable_')).toThrow(/pas une clé publishable/)
  })

  it('ne cite jamais la clé dans son message', () => {
    for (const cle of ['sb_secret_ne-pas-citer', 'eyJne-pas-citer.eyJ.x']) {
      try {
        verifierClePublique(cle)
        expect.unreachable(`accepté : ${cle}`)
      } catch (err) {
        expect((err as Error).message).not.toContain('ne-pas-citer')
      }
    }
  })
})

describe('la clé que le build écrit dans l’application', () => {
  it('est une clé publishable, dans .env.production comme dans .env.example', () => {
    // Le build lit `.env.production` et ÉCRIT la clé dans l'application : une clé refusée ici ferait
    // lever l'application au chargement, pour tous les utilisateurs.
    for (const fichier of ['.env.production', '.env.example']) {
      expect(() => verifierClePublique(valeurDans(fichier, 'VITE_SUPABASE_PUBLISHABLE_KEY')), fichier).not.toThrow()
    }
  })

  it('passe par le contrôle avant de servir', () => {
    const source = readFileSync(racine('src/lib/supabase.ts'), 'utf8')
    expect(source).toMatch(/createClient\(url, verifierClePublique\(import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY\)\)/)
    expect(source).not.toMatch(/VITE_SUPABASE_ANON_KEY/)
  })
})
