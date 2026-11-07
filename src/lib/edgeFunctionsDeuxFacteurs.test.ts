import { beforeAll, describe, expect, it } from 'vitest'
import {
  PERSONNES, chargerFonction, decrire, depensesDe, mondeDeReference, muter, prechauffer, requeteDe, slugsDesFonctions, sourceDe,
  type Monde, type Personne,
} from '../test/fonctionsEdge'

// LA DOUBLE AUTHENTIFICATION EXIGÉE, AUX EDGE FUNCTIONS (C7, second temps ; migration `deux_facteurs_exiges`, PRÉPARÉE ;
// HISTORIQUE.md, « LA DOUBLE AUTHENTIFICATION, SECOND TEMPS : EXIGÉE EN BASE »).
//
// Une fonction qui lit avec la clé secrète contourne la RLS et la pré-requête de PostgREST : chacune de celles qui agissent
// pour un compte porte le bloc « DEUX FACTEURS », identique partout, qui refuse en 403 un jeton `aal1` d'un compte exigé,
// avant toute dépense. Le garde part de TOUTES les fonctions (une exception porte sa raison), le bloc est le même partout,
// son drapeau baissé tant que la migration n'est pas en base ; puis chaque fonction se joue en HTTP, drapeau levé en
// mémoire, devant le monde de référence : exigé à aal1 (403, rien dépensé), à aal2 et non exigé (le bloc laisse passer),
// la base illisible (503) ; et drapeau baissé, l'état d'avant : aucune lecture de plus.

const DRAPEAU_BAISSE = 'const DEUX_FACTEURS_EXIGES_EN_BASE = false'
const DRAPEAU_LEVE = 'const DEUX_FACTEURS_EXIGES_EN_BASE = true'
const DEBUT = '// ── DÉBUT DEUX FACTEURS'
const FIN = '// ── FIN DEUX FACTEURS'

/** Les fonctions qui n'agissent pour aucun compte, et pourquoi le bloc n'y a rien à garder. */
const SANS_COMPTE: Record<string, string> = {
  'receive-email': 'webhook de Resend : un serveur, signé par Svix, aucun compte',
  'evaluer-extraction': 'harnais de mesure, appelé à la main derrière la clé publishable, aucun compte',
  'taux-change-bce': 'aucun contrôle d’appelant (défaut connu, DEFAUTS_CONNUS) : elle ne lit ni n’écrit rien d’un dossier',
}

/** Qui appelle chaque fonction dans le monde de référence : le chef, sauf les fonctions du super-administrateur. */
const APPELANT: Record<string, Personne> = { 'create-cabinet': 'superAdmin', 'delete-cabinet': 'superAdmin' }

const AVEC_LE_BLOC = slugsDesFonctions().filter((s) => !(s in SANS_COMPTE))

function blocDe(source: string): string {
  const debut = source.indexOf(DEBUT)
  const fin = source.indexOf(FIN)
  return debut >= 0 && fin > debut ? source.slice(debut, source.indexOf('\n', fin)) : ''
}

const MESSAGE_403 = 'Cette session ne satisfait pas la double authentification de ce compte'

async function jouer(slug: string, options: { leve: boolean; exige: boolean; aal2: boolean; panne?: boolean; avantRetrait?: boolean }) {
  const monde: Monde = mondeDeReference()
  const qui = APPELANT[slug] ?? 'chef'
  if (options.exige) monde.deuxFacteurs.exiges.push(PERSONNES[qui].id)
  if (options.aal2) monde.deuxFacteurs.jetonsAal2.push(PERSONNES[qui].jeton)
  if (options.avantRetrait) monde.deuxFacteurs.jetonsAvantRetrait.push(PERSONNES[qui].jeton)
  if (options.panne) monde.pannes.push({ rpc: 'deux_facteurs_satisfaits', erreur: { message: 'délai dépassé' } })
  const source = options.leve ? muter(sourceDe(slug), [[DRAPEAU_BAISSE, DRAPEAU_LEVE]]) : sourceDe(slug)
  const fonction = chargerFonction(slug, monde, { source })
  const resultat = await fonction.appeler(requeteDe(slug, { personne: qui, corps: {} }))
  const lectures = monde.journal.filter((e) => e.genre === 'rpc' && e.nom === 'deux_facteurs_satisfaits')
  return { resultat, lectures, depenses: depensesDe(monde.journal).map(decrire), monde }
}

describe('le bloc DEUX FACTEURS part de TOUTES les fonctions', () => {
  it('chaque fonction le porte, sauf celles qui n’agissent pour aucun compte, et chaque exception vise une fonction qui existe', () => {
    const toutes = slugsDesFonctions()
    expect(Object.keys(SANS_COMPTE).filter((s) => !toutes.includes(s))).toEqual([])
    for (const slug of toutes) {
      const source = sourceDe(slug)
      if (slug in SANS_COMPTE) expect(source.includes(DEBUT), slug).toBe(false)
      else expect(blocDe(source), slug).not.toBe('')
    }
    // Le plancher : les treize fonctions qui agissent pour un compte le 07/11/2026.
    expect(AVEC_LE_BLOC.length).toBeGreaterThanOrEqual(13)
  })

  it('une fonction qui lit un compte (`auth.getUser`) porte le bloc — un défaut planté le prouve', () => {
    const lisentUnCompte = (source: string) => /\.auth\.getUser\(/.test(source)
    for (const slug of slugsDesFonctions()) {
      if (lisentUnCompte(sourceDe(slug))) expect(slug in SANS_COMPTE ? 'exception' : blocDe(sourceDe(slug)), slug).not.toBe('')
    }
    const plante = sourceDe('send-email').replace(blocDe(sourceDe('send-email')), '')
    expect(lisentUnCompte(plante) && blocDe(plante) === '').toBe(true)
  })

  it('le bloc est le même partout, son drapeau baissé, et son appel unique, après le contrôle de l’appelant', () => {
    const reference = blocDe(sourceDe('send-email'))
    for (const slug of AVEC_LE_BLOC) {
      const source = sourceDe(slug)
      expect(blocDe(source), slug).toBe(reference)
      expect(source.split(DRAPEAU_BAISSE).length - 1, slug).toBe(1)
      const horsDuBloc = source.replace(reference, '')
      expect(horsDuBloc.match(/await refusDesDeuxFacteurs\(/g)?.length, slug).toBe(1)
      expect(horsDuBloc.indexOf('await refusDesDeuxFacteurs('), slug).toBeGreaterThan(horsDuBloc.indexOf('.auth.getUser('))
    }
  })
})

describe.each(AVEC_LE_BLOC.map((s) => [s] as const))('%s — la double authentification exigée, en HTTP', (slug) => {
  beforeAll(() => {
    prechauffer(sourceDe(slug))
    prechauffer(muter(sourceDe(slug), [[DRAPEAU_BAISSE, DRAPEAU_LEVE]]))
  })

  it('drapeau levé, un compte exigé à aal1 : 403 en français, la base lue au jeton de l’appelant, rien dépensé', async () => {
    const { resultat, lectures, depenses } = await jouer(slug, { leve: true, exige: true, aal2: false })
    expect(resultat.statut).toBe(403)
    expect(JSON.stringify(resultat.json)).toContain(MESSAGE_403)
    expect(lectures.map((e) => e.genre === 'rpc' && e.role)).toEqual(['authentifie'])
    expect(depenses).toEqual([])
  })

  it('drapeau levé, à aal2 ou sans exigence : le bloc laisse passer', async () => {
    for (const cas of [{ exige: true, aal2: true }, { exige: false, aal2: false }]) {
      const { resultat, lectures } = await jouer(slug, { leve: true, ...cas })
      expect(lectures).toHaveLength(1)
      expect(JSON.stringify(resultat.json ?? resultat.texte)).not.toContain('double authentification')
    }
  })

  it('drapeau levé, un jeton émis avant le retrait du second facteur (l’appareil perdu) : 403, même à aal2, même sans exigence', async () => {
    for (const cas of [{ exige: true, aal2: true }, { exige: false, aal2: false }]) {
      const { resultat, lectures, depenses } = await jouer(slug, { leve: true, ...cas, avantRetrait: true })
      expect(resultat.statut).toBe(403)
      expect(JSON.stringify(resultat.json)).toContain(MESSAGE_403)
      expect(lectures).toHaveLength(1)
      expect(depenses).toEqual([])
    }
  })

  it('drapeau levé, la base illisible : 503, le côté fermé, rien dépensé', async () => {
    const { resultat, depenses } = await jouer(slug, { leve: true, exige: false, aal2: false, panne: true })
    expect(resultat.statut).toBe(503)
    expect(JSON.stringify(resultat.json)).toContain('n’a pas pu être vérifiée'.replace('’', "'"))
    expect(depenses).toEqual([])
  })

  it('drapeau baissé (la vraie source) : l’état d’avant, aucune lecture de plus, même pour un compte exigé', async () => {
    const { resultat, lectures } = await jouer(slug, { leve: false, exige: true, aal2: false })
    expect(lectures).toEqual([])
    expect(JSON.stringify(resultat.json ?? resultat.texte)).not.toContain('double authentification')
  })
})
