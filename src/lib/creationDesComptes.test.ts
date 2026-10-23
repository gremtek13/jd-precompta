import { readFileSync } from 'node:fs'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  CHAMP_DE_LA_CONFIRMATION, MARQUEUR_DU_RATTACHEMENT, avisDeLAccesCree, avisDuMembreAjoute, compteDeLaReponse,
  confirmationDuRattachement, copieDuRefus, corpsDeLaCreation, rattachementAConfirmer, refusARattacher,
} from './creationDesComptes'
import { CE_QUE_DONNE_UN_ACCES, DOMAINES } from './droitsAcces'
import { extraireErreurFonction } from './invokeErreur'

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

// LE RATTACHEMENT D'UN COMPTE QUE CE CABINET NE CONNAÎT PAS, OU PLUS (23-Q2, décision du cabinet du 18/10/2026). Le module
// décide de ce qui part (le corps des deux appels), de ce qu'il lit du refus (le marqueur, et lui seul) et de ce que dit la
// fenêtre. La fonction est confrontée ici à son texte ; son comportement, dans le contrat HTTP (contratsFonctions.ts).
describe('le rattachement d’un compte que ce cabinet ne connaît pas, ou plus (23-Q2)', () => {
  const source = readFileSync(new URL('../../supabase/functions/create-client-access/index.ts', import.meta.url), 'utf8')

  it('le premier appel ne porte aucune confirmation ; le second, le booléen true et lui seul, avec l’adresse et le mot de passe', () => {
    expect(corpsDeLaCreation('d1', ADRESSE, 'Mot-de-passe-1', false)).toEqual({ dossierId: 'd1', email: ADRESSE, password: 'Mot-de-passe-1' })
    const second = corpsDeLaCreation('d1', ADRESSE, 'Mot-de-passe-1', true)
    expect(second).toEqual({ dossierId: 'd1', email: ADRESSE, password: 'Mot-de-passe-1', rattachementConfirme: true })
    expect(second[CHAMP_DE_LA_CONFIRMATION]).toBe(true)
  })

  it('seul le booléen true, sur un objet, dit qu’une confirmation est possible', () => {
    expect(rattachementAConfirmer({ error: 'refus', rattachementAConfirmer: true })).toBe(true)
    for (const corps of [
      { error: 'refus' }, { rattachementAConfirmer: 'true' }, { rattachementAConfirmer: 1 }, { rattachementAConfirmer: false },
      { rattachementAConfirmer: null }, { rattachementAConfirmer: [true] }, { rattachementConfirme: true }, [true],
      Object.assign([], { rattachementAConfirmer: true }), null, undefined, 'rattachementAConfirmer', true, 1,
    ]) {
      expect(rattachementAConfirmer(corps), JSON.stringify(corps) ?? String(corps)).toBe(false)
    }
  })

  // Le corps d'une réponse ne se lit qu'une fois : la copie doit laisser l'original à `extraireErreurFonction`.
  it('la copie du refus porte le marqueur, et l’original garde sa phrase pour extraireErreurFonction', async () => {
    const refus = (corps: unknown, statut = 409) =>
      new FunctionsHttpError(new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } }))
    const avecMarqueur = refus({ error: 'Un compte existe déjà.', rattachementAConfirmer: true })
    const copie = copieDuRefus(avecMarqueur)
    expect(await extraireErreurFonction(avecMarqueur)).toBe('Un compte existe déjà.')
    expect(await refusARattacher(copie)).toBe(true)

    const sansMarqueur = refus({ error: 'Ce compte ne peut pas recevoir d’accès client.' })
    const copieSans = copieDuRefus(sansMarqueur)
    expect(await extraireErreurFonction(sansMarqueur)).toBe('Ce compte ne peut pas recevoir d’accès client.')
    expect(await refusARattacher(copieSans)).toBe(false)
  })

  it('rien à copier d’un corps déjà lu, d’une erreur sans réponse ; une copie illisible ne porte aucun marqueur', async () => {
    const lu = new FunctionsHttpError(new Response(JSON.stringify({ rattachementAConfirmer: true }), { status: 409 }))
    await extraireErreurFonction(lu)
    expect(copieDuRefus(lu)).toBeNull()
    for (const erreur of [null, undefined, 'refus', new Error('refus'), { context: 'pas une réponse' }, { context: null }]) {
      expect(copieDuRefus(erreur), String(erreur)).toBeNull()
    }
    expect(await refusARattacher(null)).toBe(false)
    expect(await refusARattacher(new Response('<html>délai dépassé</html>', { status: 504 }))).toBe(false)
    expect(await refusARattacher(new Response(JSON.stringify([{ rattachementAConfirmer: true }]), { status: 409 }))).toBe(false)
  })

  it('la fenêtre nomme l’adresse telle qu’elle partira et le dossier, dit ce que l’accès ouvre, et que le mot de passe ne sert pas', () => {
    const adresse = 'Ancien.Client+cabinet@exemple.fr'
    const c = confirmationDuRattachement(adresse, 'Cabinet Martin')
    // L'adresse est rendue telle quelle : ni casse changée, ni blanc retiré.
    expect(c.adresse.adresse).toBe(adresse)
    expect(c.adresse.avant).toBe("L'adresse ")
    const phrase = `${c.adresse.avant}${c.adresse.adresse}${c.adresse.apres}`
    expect(phrase).toContain(`L'adresse ${adresse} a déjà un compte, que ce cabinet ne connaît pas, ou plus`)
    expect(phrase).toContain('Vérifie que c\'est bien celle de ton client')
    expect(phrase).toContain('le dossier « Cabinet Martin »')
    expect(phrase).toContain('avec son propre mot de passe')
    // Ce que l'accès ouvre : la phrase de l'onglet, à l'état de son drapeau — jamais une règle recopiée.
    expect(c.paragraphes).toContain(CE_QUE_DONNE_UN_ACCES)
    expect(c.paragraphes.join(' ')).toContain(`sans les cases ${DOMAINES.map((d) => `« ${d.libelle} »`).join(' et ')}`)
    expect(c.paragraphes.join(' ')).toContain('Le mot de passe initial que tu as saisi ne sert pas : ce compte garde le sien')
    expect(c.paragraphes.join(' ')).toContain('« Envoyer un lien de réinitialisation »')
    expect(`${phrase} ${c.paragraphes.join(' ')}`).not.toContain('communique-lui')
    expect(c.titre).toBe('Rattacher ce compte au dossier ?')
    expect(c.bouton).toBe('Rattacher ce compte')
  })

  // Le module et la fonction parlent du même champ et du même marqueur : le contrat HTTP envoie le corps du module, et la
  // source les écrit, chacun une fois, sous ces noms.
  it('le champ et le marqueur sont ceux que la fonction lit et écrit', () => {
    expect(source.match(/payload\.rattachementConfirme\b/g)).toHaveLength(1)
    expect(source).toContain(`${CHAMP_DE_LA_CONFIRMATION}?: unknown`)
    expect(source.match(new RegExp(`\\b${MARQUEUR_DU_RATTACHEMENT}: true,`, 'g'))).toHaveLength(1)
    expect(source).toContain('const rattachementConfirme = confirmationLue === true')
  })
})
