import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Le GESTIONNAIRE de `proposer-categorie` — ce que ni le garde des copies (le contrat), ni celui des
// régions, ni celui des actions IAM ne regardent : dans quel ORDRE la fonction contrôle, dépense et
// répond, et ce qu'elle s'interdit. Il ne s'exécute pas ici (Deno, SDK non installés) ; il se lit, et
// chaque règle ci-dessous est de celles qu'une édition future casserait sans qu'aucun écran ne le
// montre — la fonction continuerait de proposer des catégories.

const SOURCE = readFileSync(new URL('../../supabase/functions/proposer-categorie/index.ts', import.meta.url), 'utf8')

/** Le code seul : les lignes entièrement en commentaire citent volontiers ce qu'elles interdisent. */
const CODE = SOURCE.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

const GESTIONNAIRE = CODE.slice(CODE.indexOf('Deno.serve('))

function position(motif: string): number {
  const i = GESTIONNAIRE.indexOf(motif)
  expect(i, `« ${motif} » introuvable dans le gestionnaire — garde-fou à remettre à jour`).toBeGreaterThan(-1)
  return i
}

describe('proposer-categorie — le gestionnaire', () => {
  it('existe, et le garde le voit', () => {
    expect(GESTIONNAIRE.length).toBeGreaterThan(1000)
  })

  it('ne dépense rien avant d’avoir établi QUI appelle, et sur QUEL dossier', () => {
    // Un appel au modèle est facturé : il ne part qu'après la session vérifiée ET l'accès au dossier
    // de la pièce. Un client lit ses propres pièces — la RLS ne suffit pas à dire qu'on est du cabinet.
    const modele = position('new AnthropicBedrock(')
    expect(position('.auth.getUser()')).toBeLessThan(modele)
    expect(position('.rpc("admin_du_dossier", { p_dossier_id: piece.dossier_id })')).toBeLessThan(modele)
    expect(position('if (!aAcces)')).toBeLessThan(modele)
  })

  it('ne paie pas un appel qui n’a rien à citer, ni une question amputée', () => {
    const modele = position('new AnthropicBedrock(')
    // Pas de texte lu : refusé AVANT le modèle, donc sans rien facturer — c'est ce qui permet à la
    // fiche d'offrir le bouton dans le doute.
    expect(position('if (!texte.trim())')).toBeLessThan(modele)
    // Des catégories lues en partie changeraient la question posée sans le dire.
    expect(position('if (categories.length !== lues.count)')).toBeLessThan(modele)
    expect(GESTIONNAIRE).toMatch(/\.select\("id, code, libelle, poste_2035, compte_comptable, dossier_id", \{ count: "exact" \}\)/)
  })

  it('n’écrit RIEN — la proposition revient à l’écran, l’opérateur l’applique puis enregistre', () => {
    // C'est le contrat de toute proposition de ce projet (CLAUDE.md) : rien n'est écrit sans le clic
    // de l'opérateur. Une fonction qui poserait la catégorie elle-même le romprait, et resterait verte
    // partout ailleurs.
    for (const ecriture of ['.insert(', '.update(', '.upsert(', '.delete(', '.storage']) {
      expect(CODE, `écriture « ${ecriture} » dans proposer-categorie`).not.toContain(ecriture)
    }
    // La seule fonction SQL appelée est le contrôle d'accès, qui lit.
    expect([...CODE.matchAll(/\.rpc\("([^"]+)"/g)].map((m) => m[1])).toEqual(['admin_du_dossier'])
  })

  it('lit avec le jeton de l’appelant, jamais avec la clé de service', () => {
    // La RLS dit ce que l'appelant peut voir ; la clé de service la contournerait, et seul le
    // contrôle d'accès resterait entre un appelant et les pièces des autres dossiers.
    expect(CODE).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('ne journalise jamais l’extrait ni le texte — un fragment de document peut être un nom de patient', () => {
    const journaux = [...CODE.matchAll(/console\.(?:log|warn|error|info)\(([\s\S]*?)\)\n/g)].map((m) => m[1])
    expect(journaux.length, 'aucun journal trouvé — garde-fou à remettre à jour').toBeGreaterThan(0)
    for (const j of journaux) {
      expect(j, `journal : ${j.slice(0, 80)}`).not.toMatch(/\bindice\b|\btexte\b|\bbrut\b|\bprompt\b|verifiee\.indice/)
    }
  })

  it('ne renvoie l’extrait qu’avec une proposition retenue', () => {
    expect(GESTIONNAIRE).toMatch(/indice: retenue \? verifiee\.indice : null,/)
    expect(GESTIONNAIRE).toMatch(/categorieId: retenue\?\.id \?\? null,/)
  })
})
