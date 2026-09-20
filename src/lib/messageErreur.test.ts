import { describe, expect, it } from 'vitest'
import { messageErreur } from './messageErreur'

// Le cas qui justifie tout le module est le PREMIER : une erreur Postgrest est un objet NU. Un test
// qui ne poserait que des instances d'`Error` passerait au vert avec le défaut d'origine intact —
// c'est exactement ce qui a permis à `err instanceof Error` de vivre dans quarante-six catch.
describe('messageErreur', () => {
  it("rend le message d'une erreur Postgrest, qui n'est PAS une instance d'Error", () => {
    // La forme exacte rendue par supabase-js sur le chemin non levant : JSON.parse du corps.
    const erreurPostgrest = {
      message: 'new row violates row-level security policy for table "ecritures_brouillon"',
      details: null,
      hint: null,
      code: '42501',
    }
    expect(erreurPostgrest instanceof Error).toBe(false)
    expect(messageErreur(erreurPostgrest)).toBe(
      'new row violates row-level security policy for table "ecritures_brouillon"',
    )
  })

  it("rend aussi le message d'une vraie Error — les deux formes passent par la même branche", () => {
    expect(messageErreur(new Error('Lecture du PDF impossible.'))).toBe('Lecture du PDF impossible.')
    expect(messageErreur(new TypeError('x is not a function'))).toBe('x is not a function')
  })

  it('retombe sur le repli quand il n’y a rien à dire', () => {
    expect(messageErreur(null)).toBe('Une erreur est survenue.')
    expect(messageErreur(undefined)).toBe('Une erreur est survenue.')
    expect(messageErreur({})).toBe('Une erreur est survenue.')
    expect(messageErreur(new Error(''))).toBe('Une erreur est survenue.')
    expect(messageErreur({ message: '   ' })).toBe('Une erreur est survenue.')
  })

  it('refuse un `message` qui n’est pas une chaîne plutôt que de l’afficher', () => {
    // Une valeur d'un autre type ne vient pas de Postgres. « 42 » à l'écran serait plus déroutant
    // que le repli, et un objet imprimerait « [object Object] ».
    expect(messageErreur({ message: 42 })).toBe('Une erreur est survenue.')
    expect(messageErreur({ message: { texte: 'non' } })).toBe('Une erreur est survenue.')
    expect(messageErreur({ message: null })).toBe('Une erreur est survenue.')
  })

  it('rend une chaîne levée telle quelle, son repli sinon', () => {
    expect(messageErreur('Le fichier est trop volumineux.')).toBe('Le fichier est trop volumineux.')
    expect(messageErreur('')).toBe('Une erreur est survenue.')
    expect(messageErreur('   ')).toBe('Une erreur est survenue.')
  })

  it('utilise le repli de l’appelant, qui porte la conséquence pour l’utilisateur', () => {
    expect(messageErreur(null, "L'import a échoué.")).toBe("L'import a échoué.")
    // Et jamais à la place d'un message réel : le repli ne sert QUE faute de mieux.
    expect(messageErreur({ message: 'timeout' }, "L'import a échoué.")).toBe('timeout')
  })
})
