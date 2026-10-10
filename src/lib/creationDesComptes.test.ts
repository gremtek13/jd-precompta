import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { avisDeLAccesCree, avisDuMembreAjoute, compteDeLaReponse } from './creationDesComptes'

// CE QUE L'ÉCRAN DIT APRÈS UNE CRÉATION, selon ce que la fonction a fait du compte (décision du cabinet du 10/10/2026 :
// un compte qui existe déjà garde son mot de passe). Le pire sens est connu : dire « communique-lui le mot de passe »
// d'un compte repris, sur lequel ce mot de passe n'a jamais été posé — le client cherche alors une erreur de saisie de son
// côté, et rien chez le cabinet ne dit le contraire.

const ADRESSE = 'client@exemple.invalid'

describe('le compte, lu dans la réponse de la fonction', () => {
  it('« existant » et « cree », tels que les fonctions les écrivent', () => {
    expect(compteDeLaReponse({ ok: true, compte: 'existant' })).toBe('existant')
    expect(compteDeLaReponse({ ok: true, compte: 'cree' })).toBe('cree')
  })

  it('sans le champ, une fonction d’avant le 10/10/2026 : elle avait posé le mot de passe saisi, comme pour un compte créé', () => {
    expect(compteDeLaReponse({ ok: true })).toBe('cree')
  })

  it('toute autre réponse ne dit rien de sûr', () => {
    for (const reponse of [
      { ok: true, compte: 'Existant' }, { ok: true, compte: 'repris' }, { ok: true, compte: '' }, { ok: true, compte: null },
      { ok: true, compte: 1 }, { ok: true, compte: true }, null, undefined, 'ok', 42, true,
    ]) {
      expect(compteDeLaReponse(reponse), JSON.stringify(reponse) ?? String(reponse)).toBe('inconnu')
    }
  })

  // Le module comprend deux valeurs ; les deux fonctions n'en écrivent pas d'autre. Une troisième (un renommage, une
  // faute de frappe) tomberait ici, au lieu de passer à l'écran pour une réponse « qui ne dit rien de sûr ».
  it.each(['create-client-access', 'create-team-member'])('%s n’écrit que les deux valeurs que le module comprend', (fonction) => {
    const source = readFileSync(new URL(`../../supabase/functions/${fonction}/index.ts`, import.meta.url), 'utf8')
    const valeurs = [...source.matchAll(/\bcompte = "([^"]*)"/g)].map((m) => m[1]).sort()
    expect(valeurs).toEqual(['cree', 'existant'])
    expect(valeurs.map((v) => compteDeLaReponse({ ok: true, compte: v }))).toEqual(['cree', 'existant'])
    expect(source).toContain('return json({ ok: true, compte })')
  })
})

describe('l’onglet Accès, après la création d’un accès', () => {
  it('un compte créé : le mot de passe saisi est le sien, le cabinet le communique', () => {
    expect(avisDeLAccesCree(ADRESSE, 'cree'))
      .toBe(`L'accès de ${ADRESSE} est créé : communique-lui le mot de passe initial que tu as saisi.`)
  })

  it('un compte existant : il garde son mot de passe, celui saisi ne se communique pas, le lien est nommé', () => {
    const avis = avisDeLAccesCree(ADRESSE, 'existant')
    expect(avis).toContain(`L'accès de ${ADRESSE} est créé.`)
    expect(avis).toContain('le client garde son mot de passe actuel')
    expect(avis).toContain("celui saisi ici n'a pas été posé — ne le lui communique pas")
    expect(avis).toContain('« Envoyer un lien de réinitialisation »')
    expect(avis).not.toContain('communique-lui')
  })

  it('une réponse qui ne dit rien de sûr : aucune promesse sur le mot de passe, le lien est nommé', () => {
    const avis = avisDeLAccesCree(ADRESSE, 'inconnu')
    expect(avis).toContain(ADRESSE)
    expect(avis).toContain("le mot de passe saisi n'est peut-être pas le sien")
    expect(avis).toContain('« Envoyer un lien de réinitialisation »')
    expect(avis).not.toContain('communique-lui')
    expect(avis).not.toContain('garde son mot de passe')
  })
})

describe('l’écran de l’équipe, après l’ajout d’un membre', () => {
  it('un compte créé : le mot de passe saisi est le sien, le chef le communique', () => {
    expect(avisDuMembreAjoute(ADRESSE, 'cree')).toBe(`${ADRESSE} a rejoint l'équipe : communique-lui le mot de passe que tu as saisi.`)
  })

  it('un compte existant : la personne garde son mot de passe, et « Mot de passe oublié » est son recours', () => {
    const avis = avisDuMembreAjoute(ADRESSE, 'existant')
    expect(avis).toContain(`${ADRESSE} a rejoint l'équipe.`)
    expect(avis).toContain('la personne garde son mot de passe actuel')
    expect(avis).toContain("celui saisi ici n'a pas été posé — ne le lui communique pas")
    expect(avis).toContain("« Mot de passe oublié », sur l'écran de connexion")
    expect(avis).not.toContain('communique-lui')
    // Un membre de l'équipe n'a pas de ligne dans l'onglet Accès : le bouton du lien n'est pas le sien.
    expect(avis).not.toContain('Envoyer un lien de réinitialisation')
  })

  it('une réponse qui ne dit rien de sûr : aucune promesse sur le mot de passe', () => {
    const avis = avisDuMembreAjoute(ADRESSE, 'inconnu')
    expect(avis).toContain(ADRESSE)
    expect(avis).toContain("le mot de passe saisi n'est peut-être pas le sien")
    expect(avis).toContain('« Mot de passe oublié »')
    expect(avis).not.toContain('communique-lui')
    expect(avis).not.toContain('garde son mot de passe')
  })
})
