import { readFileSync } from 'node:fs'
import { AuthApiError, AuthRetryableFetchError, AuthWeakPasswordError } from '@supabase/supabase-js'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import * as module from './recuperationMotDePasse'
import { diagnosticsSepares, executerModule } from '../test/compilationSeparee'

// LA COPIE DU BLOC refusDuService DANS LES TROIS FONCTIONS QUI CRÉENT DES COMPTES (défaut 23.5, 10/10/2026).
// create-client-access, create-team-member et create-cabinet sont auto-portées : elles lisent le refus du service
// d'authentification par une COPIE du bloc de src/lib/recuperationMotDePasse.ts. Une copie qui dériverait redirait
// « Un compte existe déjà… » d'un mot de passe refusé, ou dirait un refus qu'on n'a pas eu. Quatre questions, et aucune
// ne suffit seule (CLAUDE.md, « Une Edge Function auto-portée duplique du code ») :
//   1. Chaque copie est-elle AU CARACTÈRE PRÈS le bloc de src/lib ?
//   2. Le bloc se suffit-il, compilé seul ?
//   3. EXÉCUTÉE seule, chaque copie rend-elle ce que rend le module — une référence extérieure aux copies — sur une grille
//      d'erreurs : les vraies classes d'auth-js, et des formes que le service ne rend pas ?
//   4. Chaque fonction s'en SERT-elle, sans rien garder de l'ancienne détection ? Et le garde mord-il ?

const MODULE = readFileSync(new URL('./recuperationMotDePasse.ts', import.meta.url), 'utf8')
const FONCTIONS = ['create-client-access', 'create-team-member', 'create-cabinet'] as const
const SOURCES = Object.fromEntries(FONCTIONS.map((f) => [
  f, readFileSync(new URL(`../../supabase/functions/${f}/index.ts`, import.meta.url), 'utf8'),
])) as Record<(typeof FONCTIONS)[number], string>
const DEBUT = '// ── DÉBUT COPIE refusDuService '
const FIN = '// ── FIN COPIE refusDuService '

function blocDe(source: string, ou: string): string {
  const d = source.indexOf(DEBUT)
  const f = source.indexOf(FIN)
  expect(d, `bornes du bloc refusDuService introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(DEBUT, d + 1), `le bloc refusDuService est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc refusDuService n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINE = blocDe(MODULE, 'recuperationMotDePasse.ts')

type Copie = Pick<typeof module, 'adresseDejaInscrite' | 'refusDuMotDePasse'>

/** Le bloc SEUL, transpilé et exécuté : tout nom qu'il emprunterait au reste d'un fichier lèverait. */
function executer(bloc: string): Copie {
  return executerModule<Copie>(bloc)
}

// Le bloc fidèle, et le même qui emprunte un nom hors de lui : le garde doit voir l'emprunt.
const COMPILES = {
  origine: ORIGINE,
  emprunte: ORIGINE.replace("if (erreur === null || typeof erreur !== 'object') return null", 'if (estVide(erreur)) return null'),
}

// ── La grille ───────────────────────────────────────────────────────────────────────────────────────────────────────

const CODES: unknown[] = [
  undefined, null, 42, '', 'email_exists', 'user_already_exists', 'EMAIL_EXISTS', 'email_exists ', 'phone_exists',
  'identity_already_exists', 'weak_password', 'Weak_Password', 'validation_failed', 'unexpected_failure', 'not_admin',
  ['email_exists'], ['weak_password'],
]
const RAISONS: unknown[] = [
  undefined, null, 'length', 42, {}, [], ['length'], ['characters'], ['pwned'], ['length', 'characters'],
  ['characters', 'length'], ['pwned', 'length'], ['length', 'characters', 'pwned'], ['pwned', 'pwned'], ['inconnue'],
  ['length', 7, null], [['length']], ['LENGTH'], ['characters', 'inconnue', 'pwned'],
]
const STATUTS: unknown[] = [undefined, 400, 422, 429, 500]

/** Des objets nus : chaque code, chaque forme de raisons, chaque statut — le service n'en rend qu'une petite part. */
const NUS: unknown[] = CODES.flatMap((code) => RAISONS.flatMap((reasons) => STATUTS.map((status) => (
  { code, reasons, status, message: 'A user with this email address has already been registered' }
))))

/** Les vraies erreurs d'auth-js, comme le SDK les rend sur les réponses du service (refusDuServiceClient.test.ts). */
const VRAIES: unknown[] = [
  new AuthApiError('A user with this email address has already been registered', 422, 'email_exists'),
  new AuthApiError('User already registered', 422, 'user_already_exists'),
  new AuthApiError('Phone number already registered by another user', 422, 'phone_exists'),
  new AuthApiError('Password cannot be longer than 72 characters', 400, 'validation_failed'),
  new AuthApiError('Unable to validate email address: invalid format', 400, 'validation_failed'),
  new AuthApiError('User not allowed', 403, 'not_admin'),
  new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit'),
  new AuthRetryableFetchError('Database error creating new user', 500),
  new AuthRetryableFetchError('Failed to fetch', 0),
  ...[[], ['length'], ['characters'], ['pwned'], ['length', 'characters'], ['length', 'characters', 'pwned']].map(
    (r) => new AuthWeakPasswordError('Password should contain at least one character of each: …', 422, r as ('length' | 'characters' | 'pwned')[]),
  ),
]

/** Ce qui n'est pas un objet : le bloc le lit comme « rien », sans lever. */
const AUTRES: unknown[] = [null, undefined, 'email_exists', 42, true, Symbol('refus'), () => 'weak_password', [], {}]

const ERREURS = [...NUS, ...VRAIES, ...AUTRES]

const lire = (m: Copie) => ERREURS.map((e) => [m.adresseDejaInscrite(e), m.refusDuMotDePasse(e)])

describe('la copie du bloc refusDuService dans les trois fonctions qui créent des comptes', () => {
  // La compilation se paye UNE fois par fichier, ici (`compilationSeparee.ts`) : refaite dans chaque test, elle
  // approcherait les 5 s de Vitest sous la charge de la barrière. Son délai est déclaré pour elle seule.
  let compiles: Record<keyof typeof COMPILES, string[]>
  beforeAll(() => {
    compiles = diagnosticsSepares(COMPILES, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
      noUnusedParameters: true, lib: ['lib.es2022.d.ts'], types: [],
    })
  }, 60_000)

  it.each(FONCTIONS)('%s : au caractère près le bloc de src/lib/recuperationMotDePasse.ts', (fonction) => {
    expect(blocDe(SOURCES[fonction], fonction)).toBe(ORIGINE)
  })

  it('le bloc commence et finit à ses bornes : rien de ce que le module importe n’y entre', () => {
    expect(ORIGINE.startsWith(DEBUT)).toBe(true)
    expect(ORIGINE).not.toMatch(/^import /m)
  })

  it('se compile seul, sans rien emprunter — et le garde voit un emprunt', () => {
    expect(compiles.origine).toEqual([])
    expect(compiles.emprunte.join('\n')).toMatch(/estVide/)
  })

  it.each(FONCTIONS)('%s : exécutée seule, la copie rend ce que rend le module, sur toute la grille', (fonction) => {
    expect(lire(executer(blocDe(SOURCES[fonction], fonction)))).toEqual(lire(module))
  })

  it('la grille n’est pas aveugle : elle voit les deux codes d’une adresse inscrite, et chaque raison d’un refus', () => {
    const lus = lire(module)
    expect(lus.filter(([inscrite]) => inscrite).length).toBeGreaterThan(100)
    const refus = new Set(lus.map(([, r]) => r).filter((r) => r !== null))
    // La phrase seule, chaque raison seule, deux, et trois.
    expect(refus.size).toBeGreaterThanOrEqual(8)
    expect(lus.filter(([inscrite, r]) => inscrite && r !== null)).toEqual([])
  })

  it.each(FONCTIONS)('%s : s’en sert — l’adresse inscrite et le refus du mot de passe lus par le bloc, et plus rien de l’ancienne détection', (fonction) => {
    const horsBloc = SOURCES[fonction].replace(ORIGINE, '')
    expect(horsBloc).toMatch(/\badresseDejaInscrite\(createError\)/)
    expect(horsBloc).toMatch(/\brefusDuMotDePasse\(createError\)/)
    for (const nom of ['adresseDejaInscrite', 'refusDuMotDePasse', 'codeDuRefus', 'CODES_DEJA_INSCRIT', 'CE_QUI_MANQUE']) {
      expect(horsBloc, nom).not.toMatch(new RegExp(`(?:function|const|let|var) ${nom}\\b`))
    }
    // Le statut 422 et les mots du message ne décident plus de rien.
    expect(horsBloc).not.toMatch(/status\s*===\s*422/)
    expect(horsBloc).not.toMatch(/already\|exist/)
    expect(horsBloc).not.toMatch(/\bdejaInscrit\b/)
  })

  it('le garde mord : un caractère changé dans une copie, ou un code de plus, se voit — en texte et à l’exécution', () => {
    const copie = blocDe(SOURCES['create-client-access'], 'create-client-access')
    const derivee = copie.replace("['email_exists', 'user_already_exists']", "['email_exists', 'user_already_exists', 'phone_exists']")
    expect(derivee).not.toBe(ORIGINE)
    expect(lire(executer(derivee))).not.toEqual(lire(module))
    // Une raison qui ne se dit plus : la phrase de tête reste, et l'exécution le voit.
    const muette = copie.replace("['pwned', 'il figure parmi les mots de passe divulgués lors de fuites de données'],\n", '')
    expect(muette).not.toBe(copie)
    expect(lire(executer(muette))).not.toEqual(lire(module))
  })
})
