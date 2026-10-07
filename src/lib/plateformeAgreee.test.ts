import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// LA RÉCEPTION PAR LA PLATEFORME AGRÉÉE DU CLIENT (`plateforme-agreee`, ligne 28.5 de la feuille de route, étape b)
// SE TESTE SUR SA VRAIE SOURCE.
//
// Une Edge Function ne s'appelle pas depuis ce dépôt, et celle-ci parle à des plateformes qu'aucun test ne joint.
// Ce qui décide de sa justesse vit donc dans des blocs bornés (`── DÉBUT/FIN …`), qu'on EXTRAIT de la vraie source,
// qu'on transpile avec le compilateur du projet et qu'on EXÉCUTE — l'idiome de `banqueConnexion.test.ts` :
//   - ADRESSES    où la fonction accepte d'envoyer un secret, confronté aux contraintes de la base ;
//   - CONNEXION   ce que le cabinet enregistre, et ce que l'écran en voit (jamais le secret) ;
//   - JETON       la demande OAuth2 et la lecture de sa réponse ;
//   - FLUX        ce qu'un flux de la plateforme devient : une facture d'achat ou de vente, ou un écart compté ;
//   - RECHERCHE   la lecture page à page, par curseur ou par date, et le point de reprise qu'elle rend possible ;
//   - CURSEUR     le point de reprise retenu : borné, jamais en arrière ;
//   - FICHIER     un document lu sous son plafond et reconnu à ses premiers octets ;
//   - HTTP        le client d'une plateforme, joué ici contre un faux `fetch` : jeton, redirections, en-têtes ;
//   - ERREURS     ce que dit une plateforme qui refuse, sans écho de sa réponse.
// Puis le CÂBLAGE du gestionnaire, qui ne s'exécute pas ici : l'ordre des contrôles se lit sur la source.

const SOURCE = readFileSync(new URL('../../supabase/functions/plateforme-agreee/index.ts', import.meta.url), 'utf8')
const MIGRATION = readFileSync(
  new URL('../../supabase/schema/20261007104340_reception_par_plateforme_agreee.sql', import.meta.url), 'utf8')
const CONFIG = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')

function bloc(nom: string): string {
  const debut = SOURCE.indexOf(`// ── DÉBUT ${nom} `)
  const fin = SOURCE.indexOf(`// ── FIN ${nom} `)
  expect(debut, `bornes « ${nom} » introuvables — garde-fou à remettre à jour`).toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  return SOURCE.slice(debut, fin)
}

/** Les blocs SEULS, transpilés et exécutés : tout nom qu'ils emprunteraient au reste du fichier lèverait. */
function executer<T>(texte: string, noms: string[]): T {
  const js = ts.transpileModule(texte, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { ${noms.join(', ')} }`)() as T
}

// ── ADRESSES ─────────────────────────────────────────────────────────────────────────────────────────

type Adresse = { url: string; hote: string } | { refus: string }
const A = executer<{
  hoteRefuse: (hote: string) => string | null
  adresseNettoyee: (saisie: unknown, libelle: string, retirerVersion: boolean) => Adresse
  cibleRedirection: (location: string | null, depuis: string) => { url: string } | { refus: string }
}>(bloc('ADRESSES'), ['hoteRefuse', 'adresseNettoyee', 'cibleRedirection'])

/** La règle de la base, lue dans la migration : `[:space:]` (POSIX) s'écrit `\s` en JavaScript. */
function regleDeLaBase(contrainte: string): RegExp {
  const m = new RegExp(`constraint ${contrainte} check \\(\\s*length\\(\\w+\\) <= 500 and right\\(\\w+, 1\\) <> '/'\\s*and \\w+ ~ '([^']+)'\\)`)
    .exec(MIGRATION)
  expect(m, `contrainte ${contrainte} introuvable dans la migration`).not.toBeNull()
  return new RegExp(m![1].replace('[:space:]', '\\s'))
}

const FLUX = (saisie: unknown) => A.adresseNettoyee(saisie, 'L’adresse', true)
const JETONS = (saisie: unknown) => A.adresseNettoyee(saisie, 'L’adresse', false)

describe('plateforme-agreee — où la fonction accepte d’envoyer un secret', () => {
  it('ramène une adresse à la forme que la base garde : hôte en minuscules, sans barre finale', () => {
    expect(FLUX('  https://API.SuperPDP.tech/afnor-flow/  ')).toEqual({ url: 'https://api.superpdp.tech/afnor-flow', hote: 'api.superpdp.tech' })
    expect(FLUX('https://pa.exemple.fr')).toEqual({ url: 'https://pa.exemple.fr', hote: 'pa.exemple.fr' })
  })

  it('retire un « /v1 » final de l’adresse des flux — la fonction l’ajoute — mais jamais de celle des jetons', () => {
    for (const fin of ['/v1', '/v1/', '/V1/flows', '/v1/flows/search', '/v1/healthcheck']) {
      expect(FLUX(`https://api.superpdp.tech/afnor-flow${fin}`), fin).toEqual({
        url: 'https://api.superpdp.tech/afnor-flow', hote: 'api.superpdp.tech',
      })
    }
    // Un « /v1 » au milieu du chemin reste : il fait partie de l'adresse de la plateforme.
    expect(FLUX('https://pa.fr/v1/afnor')).toMatchObject({ url: 'https://pa.fr/v1/afnor' })
    expect(JETONS('https://auth.pa.fr/oauth/v1')).toMatchObject({ url: 'https://auth.pa.fr/oauth/v1' })
  })

  it('refuse ce qui ne désigne pas un service public en https, en disant pourquoi', () => {
    const refus: [unknown, RegExp][] = [
      ['', /vide/],
      [null, /vide/],
      ['http://pa.fr/flux', /https:\/\//],
      ['ftp://pa.fr', /https:\/\//],
      ['https://10.0.0.1/flux', /nom de domaine public/],
      ['https://[::1]/flux', /nom de domaine public/],
      ['https://localhost/flux', /nom de domaine public/],
      ['https://pa.local/flux', /réseau interne/],
      ['https://api.internal', /réseau interne/],
      ['https://x.corp', /réseau interne/],
      ['https://1.0.0.127.in-addr.arpa', /réseau interne|adresse IP/],
      ['https://10.0.0.1.nip.io/flux', /adresse IP/],
      ['https://app.10-0-0-1.sslip.io', /adresse IP/],
      ['https://-pa.fr', /nom de domaine public/],
      ['https://pa.fr:8443/flux', /port/],
      ['https://moi:secret@pa.fr/flux', /identifiants/],
      ['https://pa.fr/flux?jeton=1', /paramètres/],
      ['https://pa.fr/flux#ancre', /paramètres/],
      ['https://pa.fr/flux?', /paramètres/],
      [`https://pa.fr/${'a'.repeat(495)}`, /trop longue/],
    ]
    for (const [saisie, motif] of refus) {
      const lu = FLUX(saisie)
      expect('refus' in lu ? lu.refus : `accepté : ${JSON.stringify(lu)}`, String(saisie)).toMatch(motif)
    }
  })

  it('ce qu’elle accepte, la base l’accepte — et ce que la base refuse, elle le refuse', () => {
    const flux = regleDeLaBase('connexions_plateformes_url_flux')
    const jeton = regleDeLaBase('connexions_plateformes_url_jeton')
    const saisies = [
      'https://api.superpdp.tech/afnor-flow', 'https://PA.Exemple.FR/api/', 'https://pa.fr', 'https://xn--pl-6ka.fr/x',
      'https://pa.fr/chemin avec espace', 'https://pa.fr/%20', 'https://10.1.2.3', 'https://pa.fr:443', 'http://pa.fr',
      'https://pa.fr/a?b', 'https://pa.fr.', 'https://pâte.fr/flux', 'https://p_a.fr', 'https://pa.123',
    ]
    for (const saisie of saisies) {
      for (const [lire, regle] of [[FLUX, flux], [JETONS, jeton]] as const) {
        const lu = lire(saisie)
        if ('url' in lu) {
          expect(regle.test(lu.url) && !lu.url.endsWith('/') && lu.url.length <= 500, `${saisie} → ${lu.url}`).toBe(true)
        } else {
          // Refusée par la fonction : soit la base la refuserait aussi telle quelle, soit c'est l'une des deux règles
          // que la base ne peut pas tenir seule (réseau interne, adresse IP embarquée).
          expect(regle.test(saisie.trim()) === false || /réseau interne|adresse IP/.test(lu.refus), saisie).toBe(true)
        }
      }
    }
  })

  it('un nom de domaine international est rendu sous sa forme ASCII, que la base admet', () => {
    expect(FLUX('https://pâte.fr/flux')).toEqual({ url: 'https://xn--pte-ila.fr/flux', hote: 'xn--pte-ila.fr' })
  })

  it('une redirection de fichier : résolue depuis l’adresse d’origine, paramètres admis, mêmes règles d’hôte', () => {
    expect(A.cibleRedirection('/stockage/f.pdf?sig=abc', 'https://pa.fr/v1/flows/1?docType=Original'))
      .toEqual({ url: 'https://pa.fr/stockage/f.pdf?sig=abc' })
    expect(A.cibleRedirection('https://s3.eu-west-3.amazonaws.com/b/f.xml?X-Amz-Signature=1', 'https://pa.fr/x'))
      .toEqual({ url: 'https://s3.eu-west-3.amazonaws.com/b/f.xml?X-Amz-Signature=1' })
    for (const location of [null, 'http://pa.fr/f', 'https://169.254.169.254/latest', 'https://stockage.internal/f',
      'https://pa.fr:9000/f', 'https://u:p@pa.fr/f', 'https://169.254.169.254.nip.io/f', 'javascript:alert(1)']) {
      expect(A.cibleRedirection(location, 'https://pa.fr/x'), String(location)).toHaveProperty('refus')
    }
  })
})

// ── CONNEXION ────────────────────────────────────────────────────────────────────────────────────────

interface Lue {
  dossier_id: string; nom: string; url_flux: string; url_jeton: string; client_id: string; client_secret: string
  organisation_id: string | null; portee: string | null; recherche_depuis: string | null
  derniere_recuperation: string | null; created_at: string; updated_at: string
}
type Saisie = { valeurs: Omit<Lue, 'dossier_id' | 'recherche_depuis' | 'derniere_recuperation' | 'created_at' | 'updated_at'>; reinitialiser: boolean } | { refus: string }
const C = executer<{
  saisieDeConnexion: (payload: Record<string, unknown>, existante: Lue | null) => Saisie
  vuePublique: (c: Lue | null) => Record<string, unknown> | null
}>(bloc('ADRESSES') + bloc('CONNEXION'), ['saisieDeConnexion', 'vuePublique'])

const SAISIE = {
  nom: '  Super   PDP ',
  url_flux: 'https://api.superpdp.tech/afnor-flow/v1',
  url_jeton: 'https://api.superpdp.tech/oauth2/token',
  client_id: ' identifiant-fictif ',
  client_secret: ' secret-fictif\n',
  organisation_id: '',
  portee: '',
}

const EXISTANTE: Lue = {
  dossier_id: '00000000-0000-4000-8000-000000000001',
  nom: 'Super PDP',
  url_flux: 'https://api.superpdp.tech/afnor-flow',
  url_jeton: 'https://api.superpdp.tech/oauth2/token',
  client_id: 'identifiant-fictif',
  client_secret: 'secret-enregistre',
  organisation_id: null,
  portee: null,
  recherche_depuis: '2026-10-01T08:00:00.000+00:00',
  derniere_recuperation: '2026-10-01T08:20:00.000+00:00',
  created_at: '2026-09-30T10:00:00+00:00',
  updated_at: '2026-09-30T10:00:00.123456+00:00',
}

function valeurs(lu: Saisie) {
  if ('refus' in lu) throw new Error(`refusé : ${lu.refus}`)
  return lu
}

describe('plateforme-agreee — ce que le cabinet enregistre', () => {
  it('une première connexion : tout est nettoyé, et la recherche part du début', () => {
    expect(valeurs(C.saisieDeConnexion(SAISIE, null))).toEqual({
      valeurs: {
        nom: 'Super PDP',
        url_flux: 'https://api.superpdp.tech/afnor-flow',
        url_jeton: 'https://api.superpdp.tech/oauth2/token',
        client_id: 'identifiant-fictif',
        client_secret: 'secret-fictif',
        organisation_id: null,
        portee: null,
      },
      reinitialiser: true,
    })
  })

  it('un secret laissé vide garde celui qui est enregistré — et il est requis la première fois', () => {
    expect(valeurs(C.saisieDeConnexion({ ...SAISIE, client_secret: '  ' }, EXISTANTE)).valeurs.client_secret).toBe('secret-enregistre')
    expect(valeurs(C.saisieDeConnexion({ ...SAISIE, client_secret: undefined }, EXISTANTE)).valeurs.client_secret).toBe('secret-enregistre')
    expect(C.saisieDeConnexion({ ...SAISIE, client_secret: '' }, null)).toEqual({ refus: expect.stringMatching(/secret est requis/) })
  })

  it('la recherche ne repart du début que pour une autre plateforme, une autre identité ou une autre entreprise', () => {
    const memes = valeurs(C.saisieDeConnexion({ ...SAISIE, nom: 'Autre nom', portee: 'flux.lire', client_secret: 'nouveau' }, EXISTANTE))
    expect(memes.reinitialiser).toBe(false)
    expect(valeurs(C.saisieDeConnexion({ ...SAISIE, url_flux: 'https://autre-pa.fr/afnor' }, EXISTANTE)).reinitialiser).toBe(true)
    expect(valeurs(C.saisieDeConnexion({ ...SAISIE, client_id: 'autre-identite' }, EXISTANTE)).reinitialiser).toBe(true)
    expect(valeurs(C.saisieDeConnexion({ ...SAISIE, organisation_id: 'ORG-42' }, EXISTANTE)).reinitialiser).toBe(true)
    // L'adresse des jetons ne désigne pas les flux : en changer garde le point de reprise.
    expect(valeurs(C.saisieDeConnexion({ ...SAISIE, url_jeton: 'https://auth.superpdp.tech/token' }, EXISTANTE)).reinitialiser).toBe(false)
  })

  it('l’organisation est une valeur d’en-tête, la portée des mots séparés d’une espace', () => {
    expect(valeurs(C.saisieDeConnexion({ ...SAISIE, organisation_id: ' ORG-42 ' }, null)).valeurs.organisation_id).toBe('ORG-42')
    expect(C.saisieDeConnexion({ ...SAISIE, organisation_id: 'ORG 42' }, null)).toHaveProperty('refus')
    expect(C.saisieDeConnexion({ ...SAISIE, organisation_id: 'Société' }, null)).toHaveProperty('refus')
    expect(valeurs(C.saisieDeConnexion({ ...SAISIE, portee: ' flux.lire   flux.ecrire ' }, null)).valeurs.portee).toBe('flux.lire flux.ecrire')
    expect(C.saisieDeConnexion({ ...SAISIE, portee: 'accès' }, null)).toHaveProperty('refus')
  })

  it('refuse un nom vide ou trop long, un identifiant vide, un caractère invisible, une adresse refusée', () => {
    for (const faux of [
      { nom: '   ' }, { nom: 'n'.repeat(81) }, { client_id: '' }, { client_id: 'a\u0000b' },
      { client_secret: 'a\u0007b' }, { client_id: 'a\u007fb' }, { nom: 'Super\u009bPDP' },
      { url_flux: 'http://pa.fr' }, { url_jeton: 'https://10.0.0.1/token' },
    ]) {
      expect(C.saisieDeConnexion({ ...SAISIE, ...faux }, null), JSON.stringify(faux)).toHaveProperty('refus')
    }
  })

  it('ce que voit l’écran : jamais le secret, l’hôte des flux, et la version de la configuration lue', () => {
    const vue = C.vuePublique(EXISTANTE)!
    expect(JSON.stringify(vue)).not.toContain('secret-enregistre')
    expect(vue).not.toHaveProperty('client_secret')
    expect(vue).toMatchObject({ hote: 'api.superpdp.tech', version: EXISTANTE.updated_at, client_id: 'identifiant-fictif' })
    expect(C.vuePublique(null)).toBeNull()
  })
})

// ── JETON ────────────────────────────────────────────────────────────────────────────────────────────

const J = executer<{
  requeteJeton: (identite: { url_jeton: string; client_id: string; client_secret: string; portee: string | null }, mode: 'basic' | 'corps') =>
    { url: string; init: { method: string; headers: Record<string, string>; body: string } }
  jetonDeLaReponse: (statut: number, donnees: unknown) => { jeton: string } | { refus: string; identifiants: boolean }
}>(bloc('JETON'), ['requeteJeton', 'jetonDeLaReponse'])

const IDENTITE = { url_jeton: 'https://pa.fr/oauth2/token', client_id: 'cabinet:fictif', client_secret: 'mot de/passe+', portee: null }

describe('plateforme-agreee — la demande de jeton OAuth2', () => {
  it('en Basic, chaque partie encodée comme un formulaire (RFC 6749, §2.3.1), et le secret hors du corps', () => {
    const { url, init } = J.requeteJeton(IDENTITE, 'basic')
    expect(url).toBe('https://pa.fr/oauth2/token')
    expect(init.method).toBe('POST')
    const [schema, valeur] = init.headers.Authorization.split(' ')
    expect(schema).toBe('Basic')
    expect(Buffer.from(valeur, 'base64').toString('utf8')).toBe('cabinet%3Afictif:mot+de%2Fpasse%2B')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(new URLSearchParams(init.body).get('grant_type')).toBe('client_credentials')
    expect(init.body).not.toContain('client_secret')
    expect(init.body).not.toContain('scope')
  })

  it('dans le corps, l’identité y figure et l’en-tête Basic disparaît ; la portée part quand elle est configurée', () => {
    const { init } = J.requeteJeton({ ...IDENTITE, portee: 'flux.lire' }, 'corps')
    expect(init.headers).not.toHaveProperty('Authorization')
    const corps = new URLSearchParams(init.body)
    expect(Object.fromEntries(corps)).toEqual({
      grant_type: 'client_credentials', scope: 'flux.lire', client_id: 'cabinet:fictif', client_secret: 'mot de/passe+',
    })
  })

  it('un jeton « Bearer » se lit, quelle que soit la casse — et seulement lui', () => {
    expect(J.jetonDeLaReponse(200, { access_token: 'abc.def', token_type: 'bearer', expires_in: 300 })).toEqual({ jeton: 'abc.def' })
    expect(J.jetonDeLaReponse(200, { access_token: 'abc', token_type: 'Bearer' })).toEqual({ jeton: 'abc' })
    expect(J.jetonDeLaReponse(200, { access_token: 'abc' })).toEqual({ jeton: 'abc' })
    expect(J.jetonDeLaReponse(200, { access_token: 'abc', token_type: 'mac' })).toMatchObject({ refus: expect.stringMatching(/Bearer/) })
    for (const illisible of [null, {}, { access_token: '' }, { access_token: 'a b' }, { access_token: 42 }, { access_token: 'x'.repeat(8193) }]) {
      expect(J.jetonDeLaReponse(200, illisible), JSON.stringify(illisible).slice(0, 40)).toMatchObject({ refus: expect.stringMatching(/illisible/) })
    }
  })

  it('un refus se dit en français avec le code de la RFC — jamais le texte libre de la plateforme', () => {
    const refus = J.jetonDeLaReponse(400, { error: 'invalid_client', error_description: 'secret leaked: s3cr3t' })
    expect(refus).toEqual({ refus: 'La plateforme refuse l\'identifiant ou le secret. (invalid_client, 400)', identifiants: true })
    expect(JSON.stringify(J.jetonDeLaReponse(401, { error: 'invalid_scope', error_description: 'texte libre' }))).not.toContain('texte libre')
    expect(J.jetonDeLaReponse(400, { error: 'invalid_scope' })).toMatchObject({ identifiants: false, refus: expect.stringMatching(/portée/) })
    expect(J.jetonDeLaReponse(400, { error: 'unsupported_grant_type' })).toMatchObject({ refus: expect.stringMatching(/client credentials/) })
    expect(J.jetonDeLaReponse(401, null)).toMatchObject({ identifiants: true })
    expect(J.jetonDeLaReponse(404, null)).toMatchObject({ identifiants: false, refus: expect.stringMatching(/adresse des jetons/) })
    expect(J.jetonDeLaReponse(500, { error: 'boom' })).toEqual({ refus: 'La plateforme des jetons a répondu 500.', identifiants: false })
  })

  it('un code qui n’est pas de la RFC n’est ni repris ni pris pour une clé de la table', () => {
    for (const code of ['constructor', 'toString', '__proto__', 'Invalid Client']) {
      const lu = J.jetonDeLaReponse(400, { error: code })
      expect(lu, code).toEqual({ refus: 'La plateforme des jetons a répondu 400.', identifiants: false })
    }
  })
})

// ── FLUX ─────────────────────────────────────────────────────────────────────────────────────────────

interface FluxVu {
  id: string; sens: 'achat' | 'vente'; syntaxe: string; direction: 'In' | 'Out' | null; nom: string | null
  recu_le: string | null; mis_a_jour: string; etat: 'pret' | 'en_attente' | 'en_erreur'
}
type Lu = { flux: FluxVu } | { ecarte: string; misAJour: number | null }
const F = executer<{
  instantMs: (valeur: unknown) => number | null
  isoMs: (ms: number) => string
  fluxDeLaListe: (brut: unknown) => Lu
}>(bloc('FLUX'), ['instantMs', 'isoMs', 'fluxDeLaListe'])

function flux(o: Record<string, unknown> = {}) {
  return {
    flowId: 'flux-0001',
    name: 'Facture 2026-0042',
    flowSyntax: 'CII',
    flowProfile: 'CIUS',
    flowType: 'SupplierInvoice',
    flowDirection: 'In',
    processingRule: 'B2B',
    processingRuleSource: 'Computed',
    submittedAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:05:00.000Z',
    acknowledgement: { status: 'Ok' },
    ...o,
  }
}

describe('plateforme-agreee — les dates de la plateforme', () => {
  it('se lisent à la milliseconde, TRONQUÉES — jamais arrondies vers le haut', () => {
    expect(F.instantMs('2026-04-09T03:37:35.6879Z')).toBe(Date.parse('2026-04-09T03:37:35.687Z'))
    expect(F.instantMs('2026-04-09T03:37:35.687999999Z')).toBe(Date.parse('2026-04-09T03:37:35.687Z'))
    expect(F.instantMs('2026-04-09T05:37:35.1+02:00')).toBe(Date.parse('2026-04-09T03:37:35.100Z'))
    expect(F.instantMs('2026-10-01T08:00:00.123456+00:00')).toBe(Date.parse('2026-10-01T08:00:00.123Z'))
    expect(F.isoMs(F.instantMs('2026-04-09T03:37:35.6879Z')!)).toBe('2026-04-09T03:37:35.687Z')
  })

  it('une date impossible ou d’une autre forme est illisible — `Date.parse` décalerait le 30 février au 2 mars', () => {
    for (const faux of ['2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T10:60:00Z',
      '2026-01-01 10:00:00Z', '2026-01-01T10:00:00', '2026-01-01', '2026-01-01T10:00:00+25:00', 1_700_000_000_000, null]) {
      expect(F.instantMs(faux), String(faux)).toBeNull()
    }
  })
})

describe('plateforme-agreee — ce qu’un flux devient', () => {
  it('une facture reçue est un achat, une facture émise une vente — c’est le TYPE qui le dit, pas le sens du flux', () => {
    expect(F.fluxDeLaListe(flux())).toEqual({
      flux: {
        id: 'flux-0001', sens: 'achat', syntaxe: 'CII', direction: 'In', nom: 'Facture 2026-0042',
        recu_le: '2026-10-01T08:00:00.000Z', mis_a_jour: '2026-10-01T08:05:00.000Z', etat: 'pret',
      },
    })
    // Une facture d'autofacturation reçue (le client l'a émise pour l'entreprise) est une vente (§5.2.5).
    expect(F.fluxDeLaListe(flux({ flowType: 'CustomerInvoice', flowDirection: 'In' }))).toMatchObject({ flux: { sens: 'vente', direction: 'In' } })
    expect(F.fluxDeLaListe(flux({ flowType: 'SupplierInvoice', flowDirection: 'Out' }))).toMatchObject({ flux: { sens: 'achat', direction: 'Out' } })
  })

  it('un cycle de vie, un e-reporting ou un type inconnu n’est pas une pièce : écarté et compté', () => {
    for (const type of ['CustomerInvoiceLC', 'SupplierInvoiceLC', 'AggregatedCustomerTransactionReport', 'Undefined',
      'constructor', '__proto__', undefined]) {
      expect(F.fluxDeLaListe(flux({ flowType: type })), String(type)).toEqual({ ecarte: 'autre_flux', misAJour: Date.parse('2026-10-01T08:05:00.000Z') })
    }
    expect(F.fluxDeLaListe(null)).toEqual({ ecarte: 'autre_flux', misAJour: null })
  })

  it('une facture sans identifiant ou sans date de mise à jour lisible ne peut ni se dédoublonner ni se retrouver', () => {
    for (const faux of [{ flowId: '' }, { flowId: 'a b' }, { flowId: 42 }, { flowId: 'x'.repeat(201) }, { updatedAt: 'hier' }]) {
      expect(F.fluxDeLaListe(flux(faux)), JSON.stringify(faux).slice(0, 40)).toMatchObject({ ecarte: 'illisible' })
    }
  })

  it('un format qu’on ne sait pas lire est compté à part', () => {
    expect(F.fluxDeLaListe(flux({ flowSyntax: 'CDAR' }))).toMatchObject({ ecarte: 'format' })
    expect(F.fluxDeLaListe(flux({ flowSyntax: 'PDF' }))).toMatchObject({ ecarte: 'format' })
    for (const syntaxe of ['CII', 'UBL', 'Factur-X']) {
      expect(F.fluxDeLaListe(flux({ flowSyntax: syntaxe })), syntaxe).toMatchObject({ flux: { syntaxe } })
    }
  })

  it('le statut de traitement : prête, en attente, rejetée — et un statut inconnu ne se lit pas comme « prête »', () => {
    expect(F.fluxDeLaListe(flux({ acknowledgement: { status: 'Pending' } }))).toMatchObject({ flux: { etat: 'en_attente' } })
    expect(F.fluxDeLaListe(flux({ acknowledgement: { status: 'Error', details: [{ item: 'x' }] } }))).toMatchObject({ flux: { etat: 'en_erreur' } })
    for (const accuse of [undefined, null, {}, { status: 'ok' }, { status: 'Accepted' }, 'Ok']) {
      expect(F.fluxDeLaListe(flux({ acknowledgement: accuse })), JSON.stringify(accuse)).toMatchObject({ ecarte: 'statut_inconnu' })
    }
  })

  it('le nom du flux est nettoyé et borné ; une direction ou une date de dépôt illisible devient nulle', () => {
    const lu = F.fluxDeLaListe(flux({ name: ` Facture\u0000\u0007\u0085\u009b  ${'n'.repeat(400)}`, flowDirection: 'Sortant', submittedAt: 'jamais' }))
    if (!('flux' in lu)) throw new Error('écartée')
    expect(lu.flux.nom).toHaveLength(255)
    expect(lu.flux.nom!.startsWith('Facture nnn')).toBe(true)
    expect(lu.flux.direction).toBeNull()
    expect(lu.flux.recu_le).toBeNull()
  })
})

// ── RECHERCHE ────────────────────────────────────────────────────────────────────────────────────────

interface Recherche {
  flux: FluxVu[]
  ecartes: Record<string, number>
  pages: number
  complete: boolean
  motif: string | null
  jusqua: string | null
}
interface Demande { updatedAfter: string | null; cursor: string | null }
const { rechercherFlux } = executer<{
  rechercherFlux: (
    page: (demande: Demande) => Promise<unknown>,
    depuis: string | null,
    bornes: { taillePage: number; maxFlux: number; maxPages: number; echeance: number; maintenant: () => number },
  ) => Promise<Recherche>
}>(bloc('FLUX') + bloc('RECHERCHE'), ['rechercherFlux'])

const BORNES = { taillePage: 3, maxFlux: 100, maxPages: 20, echeance: Number.POSITIVE_INFINITY, maintenant: () => 0 }
const T = (minute: number) => `2026-10-01T08:${String(minute).padStart(2, '0')}:00.000Z`
const facture = (id: string, minute: number, o: Record<string, unknown> = {}) => flux({ flowId: id, updatedAt: T(minute), ...o })

/** Une plateforme qui sert ses pages dans l'ordre et retient chaque demande. */
function plateforme(pages: unknown[]) {
  const demandes: Demande[] = []
  let n = 0
  return {
    demandes,
    page: async (demande: Demande) => {
      demandes.push(demande)
      if (n >= pages.length) throw new Error('page de trop demandée')
      return pages[n++]
    },
  }
}

const ids = (r: Recherche) => r.flux.map((f) => f.id)

describe('plateforme-agreee — la recherche page à page', () => {
  it('une page plus courte que demandée est la dernière : lecture complète, reprise à la plus grande date lue', async () => {
    const p = plateforme([{ results: [facture('a', 1), facture('b', 2)] }])
    const r = await rechercherFlux(p.page, '2026-10-01T07:00:00.000Z', BORNES)
    expect(r).toMatchObject({ complete: true, motif: null, pages: 1, jusqua: T(2) })
    expect(ids(r)).toEqual(['a', 'b'])
    expect(p.demandes).toEqual([{ updatedAfter: '2026-10-01T07:00:00.000Z', cursor: null }])
  })

  it('suit le curseur de la norme, avec la même date de départ, jusqu’à ce qu’il disparaisse', async () => {
    const p = plateforme([
      { results: [facture('a', 1), facture('b', 2), facture('c', 3)], nextCursor: 'k1' },
      { results: [facture('d', 4)], nextCursor: '' },
    ])
    const r = await rechercherFlux(p.page, null, BORNES)
    expect(r).toMatchObject({ complete: true, pages: 2, jusqua: T(4) })
    expect(ids(r)).toEqual(['a', 'b', 'c', 'd'])
    expect(p.demandes).toEqual([{ updatedAfter: null, cursor: null }, { updatedAfter: null, cursor: 'k1' }])
  })

  it('un curseur déjà servi rend la lecture INCOMPLÈTE au lieu de tourner', async () => {
    const p = plateforme([
      { results: [facture('a', 1)], nextCursor: 'k1' },
      { results: [facture('b', 2)], nextCursor: 'k2' },
      { results: [facture('c', 3)], nextCursor: 'k1' },
    ])
    const r = await rechercherFlux(p.page, null, BORNES)
    expect(r).toMatchObject({ complete: false, pages: 3 })
    expect(r.motif).toMatch(/deux fois la même page/)
    expect(p.demandes).toHaveLength(3)
  })

  it('sans curseur, une page PLEINE repart de la plus grande date strictement inférieure à la dernière, et les flux relus s’écartent', async () => {
    const p = plateforme([
      { results: [facture('a', 1), facture('b', 2), facture('c', 2)] },
      // La plateforme rend ce qui suit le 08:01 : b et c (relus), puis d — la page n'est plus pleine.
      { results: [facture('b', 2), facture('c', 2), facture('d', 2)] },
      { results: [facture('b', 2), facture('c', 2), facture('d', 2)] },
    ])
    const r = await rechercherFlux(p.page, null, BORNES)
    // La deuxième page est PLEINE, et toutes ses dates sont égales : la lecture ne peut plus avancer.
    expect(r.complete).toBe(false)
    expect(r.motif).toMatch(/même date/)
    expect(ids(r)).toEqual(['a', 'b', 'c', 'd'])
    expect(r.ecartes.doublons).toBe(2)
    expect(p.demandes[1]).toEqual({ updatedAfter: T(1), cursor: null })
    // Des flux à 08:02 peuvent rester à lire : la reprise reste avant eux.
    expect(r.jusqua).toBe(T(1))
  })

  it('la pagination par date avance tant qu’elle le peut, et finit sur une page courte', async () => {
    const p = plateforme([
      { results: [facture('a', 1), facture('b', 2), facture('c', 3)] },
      { results: [facture('c', 3), facture('d', 4), facture('e', 5)] },
      { results: [facture('e', 5), facture('f', 6)] },
    ])
    const r = await rechercherFlux(p.page, null, BORNES)
    expect(r).toMatchObject({ complete: true, pages: 3, jusqua: T(6) })
    expect(ids(r)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(p.demandes.map((d) => d.updatedAfter)).toEqual([null, T(2), T(4)])
  })

  it('une plateforme qui n’avance plus d’une page à l’autre rend la lecture incomplète', async () => {
    const p = plateforme([
      { results: [facture('a', 1), facture('b', 2), facture('c', 3)] },
      { results: [facture('x', 1), facture('y', 2), facture('z', 3)] },
    ])
    const r = await rechercherFlux(p.page, null, BORNES)
    expect(r.complete).toBe(false)
    expect(r.motif).toMatch(/n'avance plus/)
  })

  it('au-delà des factures qu’un import traite d’un coup : incomplète, et la reprise reste avant la dernière date', async () => {
    const p = plateforme([
      { results: [facture('a', 1), facture('b', 2), facture('c', 3)], nextCursor: 'k1' },
      { results: [facture('d', 4)] },
    ])
    const r = await rechercherFlux(p.page, null, { ...BORNES, maxFlux: 3 })
    expect(r).toMatchObject({ complete: false, pages: 1, jusqua: T(2) })
    expect(r.motif).toMatch(/plus de 3 factures/)
    expect(p.demandes).toHaveLength(1)
  })

  it('la dernière page est complète même au-delà du plafond de factures', async () => {
    const p = plateforme([{ results: [facture('a', 1), facture('b', 2)] }])
    const r = await rechercherFlux(p.page, null, { ...BORNES, maxFlux: 1 })
    expect(r).toMatchObject({ complete: true, jusqua: T(2) })
  })

  it('une plateforme qui ne rend pas ses flux dans l’ordre des dates ne laisse pas avancer une lecture incomplète', async () => {
    const p = plateforme([
      { results: [facture('a', 5), facture('b', 2), facture('c', 9)], nextCursor: 'k1' },
      { results: 'rien' },
    ])
    const r = await rechercherFlux(p.page, null, BORNES)
    expect(r).toMatchObject({ complete: false, jusqua: null })
    expect(r.motif).toMatch(/illisible/)
  })

  it('complète, une lecture dans le désordre reprend quand même à sa plus grande date', async () => {
    const p = plateforme([{ results: [facture('a', 5), facture('b', 2)] }])
    expect(await rechercherFlux(p.page, null, BORNES)).toMatchObject({ complete: true, jusqua: T(5) })
  })

  it('les flux écartés comptent pour la reprise : ils ont été lus, et ne s’importeront jamais', async () => {
    const p = plateforme([{
      results: [
        facture('a', 1),
        flux({ flowId: 'lc-1', flowType: 'SupplierInvoiceLC', updatedAt: T(7) }),
        flux({ flowId: 'x', flowSyntax: 'CDAR', updatedAt: T(3) }),
      ],
    }])
    const r = await rechercherFlux(p.page, null, { ...BORNES, taillePage: 10 })
    expect(r).toMatchObject({ complete: true, jusqua: T(7) })
    expect(r.ecartes).toEqual({ autre_flux: 1, illisible: 0, format: 1, statut_inconnu: 0, doublons: 0 })
    expect(ids(r)).toEqual(['a'])
  })

  it('les factures en attente et rejetées sont rendues avec leur état : l’écran les dit, sans les importer', async () => {
    const p = plateforme([{
      results: [facture('a', 1, { acknowledgement: { status: 'Pending' } }), facture('b', 2, { acknowledgement: { status: 'Error' } })],
    }])
    const r = await rechercherFlux(p.page, null, BORNES)
    expect(r.flux.map((f) => [f.id, f.etat])).toEqual([['a', 'en_attente'], ['b', 'en_erreur']])
    expect(r.jusqua).toBe(T(2))
  })

  it('rien de lu, rien à retenir', async () => {
    const p = plateforme([{ results: [] }])
    expect(await rechercherFlux(p.page, '2026-10-01T07:00:00.000Z', BORNES)).toMatchObject({ complete: true, jusqua: null, flux: [] })
  })

  it('une page illisible, le temps et le nombre de pages arrêtent la lecture en le disant', async () => {
    expect((await rechercherFlux(plateforme([null]).page, null, BORNES)).motif).toMatch(/illisible/)
    expect((await rechercherFlux(plateforme([{ results: {} }]).page, null, BORNES)).motif).toMatch(/illisible/)

    const lente = plateforme([{ results: [facture('a', 1)], nextCursor: 'k1' }, { results: [facture('b', 2)] }])
    const r = await rechercherFlux(lente.page, null, { ...BORNES, echeance: 100, maintenant: () => 101 })
    expect(r).toMatchObject({ complete: false, pages: 1 })
    expect(r.motif).toMatch(/trop de temps/)
    expect(lente.demandes).toHaveLength(1)

    let n = 0
    const sansFin = async () => ({ results: [facture(`f${n}`, n % 60)], nextCursor: `k${++n}` })
    const longue = await rechercherFlux(sansFin, null, { ...BORNES, maxPages: 4 })
    expect(longue).toMatchObject({ complete: false, pages: 4 })
    expect(longue.motif).toMatch(/plus de 4 pages/)
  })

  it('une page refusée LÈVE : c’est au gestionnaire de dire pourquoi', async () => {
    const page = async (demande: Demande) => {
      if (demande.cursor) throw new Error('refusée par la plateforme')
      return { results: [facture('a', 1)], nextCursor: 'k1' }
    }
    await expect(rechercherFlux(page, null, BORNES)).rejects.toThrow('refusée par la plateforme')
  })
})

// ── CURSEUR ──────────────────────────────────────────────────────────────────────────────────────────

const { curseurRetenu } = executer<{
  curseurRetenu: (actuel: string | null, demande: unknown, maintenantMs: number) => { curseur: string | null } | { refus: string }
}>(bloc('FLUX') + bloc('CURSEUR'), ['curseurRetenu'])

const MAINTENANT = Date.parse('2026-10-07T12:00:00.000Z')

describe('plateforme-agreee — le point de reprise retenu', () => {
  it('avance jusqu’à la date demandée, tronquée à la milliseconde', () => {
    expect(curseurRetenu(null, '2026-10-07T10:00:00.123999Z', MAINTENANT)).toEqual({ curseur: '2026-10-07T10:00:00.123Z' })
    expect(curseurRetenu('2026-10-01T08:00:00+00:00', '2026-10-07T10:00:00Z', MAINTENANT)).toEqual({ curseur: '2026-10-07T10:00:00.000Z' })
  })

  it('jamais à moins de quinze minutes de maintenant : un flux en cours d’écriture peut apparaître avec une date passée', () => {
    expect(curseurRetenu(null, '2026-10-07T11:59:00Z', MAINTENANT)).toEqual({ curseur: '2026-10-07T11:45:00.000Z' })
    expect(curseurRetenu(null, '2026-10-07T11:45:00Z', MAINTENANT)).toEqual({ curseur: '2026-10-07T11:45:00.000Z' })
    expect(curseurRetenu(null, '2026-10-07T11:44:59.999Z', MAINTENANT)).toEqual({ curseur: '2026-10-07T11:44:59.999Z' })
  })

  it('jamais en arrière : un autre onglet a pu aller plus loin', () => {
    const actuel = '2026-10-07T10:00:00.000+00:00'
    expect(curseurRetenu(actuel, '2026-10-07T09:00:00Z', MAINTENANT)).toEqual({ curseur: actuel })
    expect(curseurRetenu(actuel, '2026-10-07T10:00:00Z', MAINTENANT)).toEqual({ curseur: actuel })
    expect(curseurRetenu(actuel, '2026-10-07T10:00:00.001Z', MAINTENANT)).toEqual({ curseur: '2026-10-07T10:00:00.001Z' })
  })

  it('rien à retenir garde le point actuel ; une date illisible est refusée', () => {
    expect(curseurRetenu('2026-10-01T08:00:00+00:00', null, MAINTENANT)).toEqual({ curseur: '2026-10-01T08:00:00+00:00' })
    expect(curseurRetenu(null, null, MAINTENANT)).toEqual({ curseur: null })
    for (const faux of ['hier', '2026-02-30T00:00:00Z', 42, undefined, {}]) {
      expect(curseurRetenu(null, faux, MAINTENANT), String(faux)).toHaveProperty('refus')
    }
  })
})

// ── FICHIER ──────────────────────────────────────────────────────────────────────────────────────────

const FI = executer<{
  lireCorps: (reponse: Response, max: number) => Promise<{ octets: Uint8Array } | { tropLourd: true }>
  natureFichier: (octets: Uint8Array) => 'pdf' | 'xml' | null
  base64De: (octets: Uint8Array) => string
}>(bloc('FICHIER'), ['lireCorps', 'natureFichier', 'base64De'])

const octets = (texte: string) => new TextEncoder().encode(texte)
function flot(morceaux: Uint8Array[], enTetes: Record<string, string> = {}) {
  let annule = false
  const corps = new ReadableStream<Uint8Array>({
    pull(c) {
      const m = morceaux.shift()
      if (m) c.enqueue(m)
      else c.close()
    },
    cancel() { annule = true },
  })
  return { reponse: new Response(corps, { headers: enTetes }), annule: () => annule }
}

describe('plateforme-agreee — un document téléchargé', () => {
  it('se lit en entier sous son plafond', async () => {
    const { reponse } = flot([octets('<?xml '), octets('version="1.0"?><a/>')])
    const lu = await FI.lireCorps(reponse, 1000)
    expect('octets' in lu && new TextDecoder().decode(lu.octets)).toBe('<?xml version="1.0"?><a/>')
  })

  it('une longueur annoncée au-delà du plafond refuse sans rien lire', async () => {
    const { reponse, annule } = flot([new Uint8Array(10)], { 'content-length': '5000' })
    expect(await FI.lireCorps(reponse, 1000)).toEqual({ tropLourd: true })
    expect(annule()).toBe(true)
  })

  it('une longueur absente ou MENSONGÈRE ne fait pas foi : le plafond se compte en lisant', async () => {
    const menteur = flot([new Uint8Array(600), new Uint8Array(600)], { 'content-length': '10' })
    expect(await FI.lireCorps(menteur.reponse, 1000)).toEqual({ tropLourd: true })
    expect(menteur.annule()).toBe(true)
    const muet = flot([new Uint8Array(600), new Uint8Array(600)])
    expect(await FI.lireCorps(muet.reponse, 1000)).toEqual({ tropLourd: true })
    const juste = flot([new Uint8Array(500), new Uint8Array(500)])
    expect(await FI.lireCorps(juste.reponse, 1000)).toMatchObject({ octets: expect.any(Uint8Array) })
  })

  it('un PDF commence par son en-tête ; un XML par sa déclaration, un commentaire ou sa racine, en UTF-8', () => {
    expect(FI.natureFichier(octets('%PDF-1.7\n%âãÏÓ'))).toBe('pdf')
    expect(FI.natureFichier(octets('<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice/>'))).toBe('xml')
    expect(FI.natureFichier(new Uint8Array([0xef, 0xbb, 0xbf, ...octets('<?xml version="1.0"?><Invoice/>')]))).toBe('xml')
    expect(FI.natureFichier(octets('\n  <Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">'))).toBe('xml')
    expect(FI.natureFichier(octets('<!-- généré --><Invoice/>'))).toBe('xml')
  })

  it('refuse une DTD — la porte des entités —, un JSON, un PDF décalé, de l’UTF-16 et le vide', () => {
    for (const faux of [
      '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>',
      '<!DOCTYPE html><html><body>lisible</body></html>',
      '<?xml version="1.0"?><!entity x "y">',
      '{"flowId":"x"}',
      ' %PDF-1.7',
      '',
    ]) {
      expect(FI.natureFichier(octets(faux)), faux.slice(0, 30)).toBeNull()
    }
    expect(FI.natureFichier(new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x61, 0x00]))).toBeNull()
  })

  it('le base64 par tranches est celui du tout, quelle que soit la taille', () => {
    for (const taille of [0, 1, 2, 3, 0x6000 - 1, 0x6000, 0x6000 + 1, 100_000]) {
      const o = Uint8Array.from({ length: taille }, (_, i) => (i * 31 + 7) % 256)
      expect(FI.base64De(o), String(taille)).toBe(Buffer.from(o).toString('base64'))
    }
  })
})

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────────

interface Appel { url: string; init: RequestInit }
type ClientPlateforme = {
  jeton: () => Promise<{ jeton: string } | { refus: string; identifiants: boolean; statut: number }>
  appelJson: (methode: 'GET' | 'POST', chemin: string, corps?: unknown) => Promise<{ statut: number; donnees: unknown; redirection: boolean }>
  fichier: (chemin: string) => Promise<{ statut: number; octets: Uint8Array | null; tropLourd: boolean; redirectionRefusee: boolean }>
}
const { clientPlateforme } = executer<{
  clientPlateforme: (config: Record<string, unknown>, recuperer: (url: string, init: RequestInit) => Promise<Response>,
    options: { delaiMs: number; maxJson: number; maxFichier: number; maxRedirections: number }) => ClientPlateforme
}>(bloc('ADRESSES') + bloc('JETON') + bloc('FICHIER') + bloc('HTTP'), ['clientPlateforme'])

const CONFIG_PA = {
  url_flux: 'https://pa.fr/afnor', url_jeton: 'https://pa.fr/oauth2/token', client_id: 'cabinet', client_secret: 'secret',
  organisation_id: null, portee: null,
}
const OPTIONS = { delaiMs: 5_000, maxJson: 10_000, maxFichier: 1_000, maxRedirections: 3 }
const reponseJson = (statut: number, corps: unknown) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } })

/** Une plateforme jouée par une suite de réponses, qui retient chaque appel. */
function fauxFetch(reponses: (Response | Error)[]) {
  const appels: Appel[] = []
  return {
    appels,
    recuperer: async (url: string, init: RequestInit) => {
      appels.push({ url, init })
      const r = reponses.shift()
      if (!r) throw new Error('appel de trop')
      if (r instanceof Error) throw r
      return r
    },
  }
}
const enTete = (a: Appel, nom: string) => (a.init.headers as Record<string, string> | undefined)?.[nom]

describe('plateforme-agreee — le client d’une plateforme', () => {
  it('un jeton obtenu une fois sert à tous les appels, sous l’en-tête Bearer', async () => {
    const f = fauxFetch([reponseJson(200, { access_token: 'jeton-1', token_type: 'Bearer' }), reponseJson(200, { results: [] }), reponseJson(200, {})])
    const c = clientPlateforme(CONFIG_PA, f.recuperer, OPTIONS)
    expect(await c.jeton()).toEqual({ jeton: 'jeton-1' })
    expect(await c.jeton()).toEqual({ jeton: 'jeton-1' })
    expect(await c.appelJson('POST', '/v1/flows/search', { where: { flowType: ['SupplierInvoice'] }, limit: 1 }))
      .toEqual({ statut: 200, donnees: { results: [] }, redirection: false })
    await c.appelJson('GET', '/v1/healthcheck')
    expect(f.appels.map((a) => a.url)).toEqual(['https://pa.fr/oauth2/token', 'https://pa.fr/afnor/v1/flows/search', 'https://pa.fr/afnor/v1/healthcheck'])
    expect(enTete(f.appels[1], 'Authorization')).toBe('Bearer jeton-1')
    expect(enTete(f.appels[1], 'Content-Type')).toBe('application/json')
    expect(JSON.parse(String(f.appels[1].init.body))).toEqual({ where: { flowType: ['SupplierInvoice'] }, limit: 1 })
    expect(enTete(f.appels[2], 'Content-Type')).toBeUndefined()
    expect(f.appels[2].init.body).toBeUndefined()
  })

  it('une plateforme qui refuse le Basic en 401 reçoit l’identité dans le corps — une fois', async () => {
    const f = fauxFetch([reponseJson(401, { error: 'invalid_client' }), reponseJson(200, { access_token: 'jeton-2' })])
    const c = clientPlateforme(CONFIG_PA, f.recuperer, OPTIONS)
    expect(await c.jeton()).toEqual({ jeton: 'jeton-2' })
    expect(enTete(f.appels[0], 'Authorization')).toMatch(/^Basic /)
    expect(enTete(f.appels[1], 'Authorization')).toBeUndefined()
    expect(new URLSearchParams(String(f.appels[1].init.body)).get('client_secret')).toBe('secret')
  })

  it('deux refus disent le second ; un refus qui n’est ni 400 ni 401 ne retente pas', async () => {
    const deux = fauxFetch([reponseJson(400, { error: 'invalid_client' }), reponseJson(401, { error: 'invalid_client' })])
    expect(await clientPlateforme(CONFIG_PA, deux.recuperer, OPTIONS).jeton())
      .toEqual({ refus: 'La plateforme refuse l\'identifiant ou le secret. (invalid_client, 401)', identifiants: true, statut: 401 })
    const panne = fauxFetch([reponseJson(503, null)])
    expect(await clientPlateforme(CONFIG_PA, panne.recuperer, OPTIONS).jeton()).toMatchObject({ statut: 503, identifiants: false })
    expect(panne.appels).toHaveLength(1)
  })

  it('une adresse des jetons qui redirige est refusée — le secret n’est pas porté ailleurs', async () => {
    const f = fauxFetch([new Response(null, { status: 302, headers: { location: 'https://ailleurs.fr/token' } })])
    expect(await clientPlateforme(CONFIG_PA, f.recuperer, OPTIONS).jeton()).toMatchObject({ refus: expect.stringMatching(/autre adresse/), statut: 302 })
    expect(f.appels).toHaveLength(1)
  })

  it('une plateforme muette se dit « pas de réponse » ; chaque appel part sans suivre les redirections, sous un délai', async () => {
    const f = fauxFetch([new Error('réseau coupé')])
    expect(await clientPlateforme(CONFIG_PA, f.recuperer, OPTIONS).jeton()).toMatchObject({ statut: 0, refus: expect.stringMatching(/pas répondu/) })
    expect(f.appels[0].init.redirect).toBe('manual')
    expect(f.appels[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it('l’organisation part sous les deux graphies quand elle est configurée, et pas autrement', async () => {
    const avec = fauxFetch([reponseJson(200, { access_token: 'j' }), reponseJson(200, {})])
    const c = clientPlateforme({ ...CONFIG_PA, organisation_id: 'ORG-42' }, avec.recuperer, OPTIONS)
    await c.jeton()
    await c.appelJson('GET', '/v1/healthcheck')
    expect(enTete(avec.appels[1], 'Organisation-Id')).toBe('ORG-42')
    expect(enTete(avec.appels[1], 'Organization-Id')).toBe('ORG-42')
    expect(enTete(avec.appels[1], 'Request-Id')).toMatch(/^[0-9a-f-]{36}$/)
    const sans = fauxFetch([reponseJson(200, { access_token: 'j' }), reponseJson(200, {})])
    const d = clientPlateforme(CONFIG_PA, sans.recuperer, OPTIONS)
    await d.jeton()
    await d.appelJson('GET', '/v1/healthcheck')
    expect(enTete(sans.appels[1], 'Organisation-Id')).toBeUndefined()
    expect(enTete(sans.appels[1], 'Organization-Id')).toBeUndefined()
  })

  it('une route JSON qui redirige ne se suit pas ; une réponse illisible ou trop lourde rend des données nulles', async () => {
    const f = fauxFetch([
      reponseJson(200, { access_token: 'j' }),
      new Response(null, { status: 301, headers: { location: 'https://pa.fr/autre' } }),
      new Response('pas du json', { status: 200 }),
      reponseJson(200, { results: 'x'.repeat(20_000) }),
      reponseJson(403, { errorCode: 'FORBIDDEN_ACCESS' }),
    ])
    const c = clientPlateforme(CONFIG_PA, f.recuperer, OPTIONS)
    await c.jeton()
    expect(await c.appelJson('GET', '/v1/healthcheck')).toEqual({ statut: 301, donnees: null, redirection: true })
    expect(await c.appelJson('GET', '/v1/healthcheck')).toEqual({ statut: 200, donnees: null, redirection: false })
    expect(await c.appelJson('GET', '/v1/healthcheck')).toEqual({ statut: 200, donnees: null, redirection: false })
    expect(await c.appelJson('GET', '/v1/healthcheck')).toEqual({ statut: 403, donnees: { errorCode: 'FORBIDDEN_ACCESS' }, redirection: false })
    expect(f.appels).toHaveLength(5)
  })

  it('un fichier suit une redirection vers un hôte public — et le jeton n’y part pas', async () => {
    const f = fauxFetch([
      reponseJson(200, { access_token: 'jeton-secret' }),
      new Response(null, { status: 302, headers: { location: 'https://stockage.pa-cdn.fr/f.xml?sig=1' } }),
      new Response('<?xml version="1.0"?><a/>', { status: 200 }),
    ])
    const c = clientPlateforme(CONFIG_PA, f.recuperer, OPTIONS)
    await c.jeton()
    const lu = await c.fichier('/v1/flows/x?docType=Original')
    expect(lu).toMatchObject({ statut: 200, tropLourd: false, redirectionRefusee: false })
    expect(new TextDecoder().decode(lu.octets!)).toBe('<?xml version="1.0"?><a/>')
    expect(f.appels[1].url).toBe('https://pa.fr/afnor/v1/flows/x?docType=Original')
    expect(enTete(f.appels[1], 'Authorization')).toBe('Bearer jeton-secret')
    expect(f.appels[2].url).toBe('https://stockage.pa-cdn.fr/f.xml?sig=1')
    expect(enTete(f.appels[2], 'Authorization')).toBeUndefined()
    expect(JSON.stringify(f.appels[2].init.headers)).not.toContain('jeton-secret')
  })

  it('une redirection de retour chez la plateforme y reporte le jeton', async () => {
    const f = fauxFetch([
      reponseJson(200, { access_token: 'j' }),
      new Response(null, { status: 302, headers: { location: 'https://cdn.fr/a' } }),
      new Response(null, { status: 302, headers: { location: 'https://pa.fr/afnor/fichier' } }),
      new Response('%PDF-1.7', { status: 200 }),
    ])
    const c = clientPlateforme(CONFIG_PA, f.recuperer, OPTIONS)
    await c.jeton()
    expect(await c.fichier('/v1/flows/x?docType=ReadableView')).toMatchObject({ statut: 200 })
    expect(enTete(f.appels[2], 'Authorization')).toBeUndefined()
    expect(enTete(f.appels[3], 'Authorization')).toBe('Bearer j')
  })

  it('une redirection vers une adresse interne, en http ou trop répétée est refusée', async () => {
    for (const location of ['http://cdn.fr/f', 'https://169.254.169.254/latest/meta-data', 'https://stockage.internal/f']) {
      const f = fauxFetch([reponseJson(200, { access_token: 'j' }), new Response(null, { status: 302, headers: { location } })])
      const c = clientPlateforme(CONFIG_PA, f.recuperer, OPTIONS)
      await c.jeton()
      expect(await c.fichier('/v1/flows/x?docType=Original'), location).toMatchObject({ octets: null, redirectionRefusee: true })
      expect(f.appels, location).toHaveLength(2)
    }
    const boucle = fauxFetch([
      reponseJson(200, { access_token: 'j' }),
      ...Array.from({ length: 4 }, (_, i) => new Response(null, { status: 302, headers: { location: `https://cdn.fr/${i}` } })),
    ])
    const c = clientPlateforme(CONFIG_PA, boucle.recuperer, OPTIONS)
    await c.jeton()
    expect(await c.fichier('/v1/flows/x?docType=Original')).toMatchObject({ octets: null, redirectionRefusee: true })
    expect(boucle.appels).toHaveLength(5)
  })

  it('un fichier trop lourd, refusé ou coupé se dit sans octets', async () => {
    const f = fauxFetch([
      reponseJson(200, { access_token: 'j' }),
      new Response(new Uint8Array(2_000), { status: 200 }),
      new Response('absent', { status: 404 }),
      new Error('coupé'),
    ])
    const c = clientPlateforme(CONFIG_PA, f.recuperer, OPTIONS)
    await c.jeton()
    expect(await c.fichier('/v1/flows/x?docType=Original')).toEqual({ statut: 200, octets: null, tropLourd: true, redirectionRefusee: false })
    expect(await c.fichier('/v1/flows/x?docType=Original')).toEqual({ statut: 404, octets: null, tropLourd: false, redirectionRefusee: false })
    expect(await c.fichier('/v1/flows/x?docType=Original')).toEqual({ statut: 0, octets: null, tropLourd: false, redirectionRefusee: false })
  })
})

// ── ERREURS ──────────────────────────────────────────────────────────────────────────────────────────

const E = executer<{
  codeAfnor: (donnees: unknown) => string | null
  erreurPlateforme: (etape: string, reponse: { statut: number; donnees: unknown; redirection: boolean }) => { message: string; statut: number; acces: boolean }
}>(bloc('ERREURS'), ['codeAfnor', 'erreurPlateforme'])

const R = (statut: number, donnees: unknown = null, redirection = false) => ({ statut, donnees, redirection })

describe('plateforme-agreee — ce que dit une plateforme qui refuse', () => {
  it('seul un code de la norme est repris, jamais son message libre', () => {
    expect(E.codeAfnor({ errorCode: 'FORBIDDEN_ACCESS', errorMessage: 'détail interne' })).toBe('FORBIDDEN_ACCESS')
    for (const faux of [{ errorCode: 'forbidden' }, { errorCode: 'A' }, { errorCode: 'CODE AVEC ESPACE' }, { errorCode: 42 }, null, 'FORBIDDEN']) {
      expect(E.codeAfnor(faux), JSON.stringify(faux)).toBeNull()
    }
    const e = E.erreurPlateforme('recherche des flux', R(403, { errorCode: 'FORBIDDEN_ACCESS', errorMessage: 'détail interne' }))
    expect(e.message).toContain('(FORBIDDEN_ACCESS)')
    expect(e.message).not.toContain('détail interne')
  })

  it('chaque refus dit quoi faire, avec le statut que l’écran attend', () => {
    expect(E.erreurPlateforme('x', R(0))).toMatchObject({ statut: 504, acces: false, message: expect.stringMatching(/pas répondu/) })
    expect(E.erreurPlateforme('x', R(302, null, true))).toMatchObject({ statut: 502, message: expect.stringMatching(/avant « \/v1 »/) })
    expect(E.erreurPlateforme('x', R(401))).toMatchObject({ statut: 502, acces: true, message: expect.stringMatching(/droits de lecture/) })
    expect(E.erreurPlateforme('x', R(403))).toMatchObject({ acces: true })
    expect(E.erreurPlateforme('x', R(404))).toMatchObject({ statut: 502, acces: false, message: expect.stringMatching(/avant « \/v1 »/) })
    expect(E.erreurPlateforme('x', R(429))).toMatchObject({ statut: 503, message: expect.stringMatching(/nombre d'appels/) })
    expect(E.erreurPlateforme('x', R(500, { errorCode: 'INTERNAL_ERROR' }))).toEqual({
      statut: 502, acces: false, message: 'La plateforme a répondu 500 (x) (INTERNAL_ERROR).',
    })
  })
})

// ── CÂBLAGE ──────────────────────────────────────────────────────────────────────────────────────────

const GESTIONNAIRE = SOURCE.slice(SOURCE.indexOf('Deno.serve('))

/** Le texte de l'appel qui commence à `debut` (parenthèses appariées). */
function appelA(texte: string, debut: number): string {
  let profondeur = 0
  for (let i = texte.indexOf('(', debut); i < texte.length; i++) {
    if (texte[i] === '(') profondeur++
    else if (texte[i] === ')') { profondeur--; if (profondeur === 0) return texte.slice(debut, i + 1) }
  }
  throw new Error('parenthèses non appariées')
}

/** Le bloc `if (action === "…") { … }` du gestionnaire qui traite l'action. */
function brancheDe(action: string): string {
  const debut = GESTIONNAIRE.indexOf(`if (action === "${action}") {`)
  expect(debut, `branche « ${action} » introuvable — garde-fou à remettre à jour`).toBeGreaterThan(-1)
  let profondeur = 0
  for (let i = GESTIONNAIRE.indexOf('{', debut); i < GESTIONNAIRE.length; i++) {
    if (GESTIONNAIRE[i] === '{') profondeur++
    else if (GESTIONNAIRE[i] === '}') { profondeur--; if (profondeur === 0) return GESTIONNAIRE.slice(debut, i + 1) }
  }
  throw new Error('accolades non appariées')
}

/** Le code d'un appel, sans le texte de ses chaînes : les gabarits ne gardent que leurs expressions `${…}`. */
function codeSeul(appel: string): string {
  let sortie = ''
  for (let i = 0; i < appel.length; i++) {
    const c = appel[i]
    if (c === '"' || c === "'") {
      for (i++; i < appel.length && appel[i] !== c; i++) if (appel[i] === '\\') i++
      continue
    }
    if (c === '`') {
      for (i++; i < appel.length && appel[i] !== '`'; i++) {
        if (appel[i] === '\\') { i++; continue }
        if (appel[i] === '$' && appel[i + 1] === '{') {
          let profondeur = 0
          for (let k = i + 1; k < appel.length; k++) {
            if (appel[k] === '{') profondeur++
            else if (appel[k] === '}') {
              profondeur--
              if (profondeur === 0) { sortie += ` ${appel.slice(i + 2, k)} `; i = k; break }
            }
          }
        }
      }
      continue
    }
    sortie += c
  }
  return sortie
}

describe('plateforme-agreee — le câblage du gestionnaire', () => {
  it('le code d’un appel se lit sans le texte de ses messages, expressions des gabarits comprises', () => {
    expect(codeSeul('json({ error: `La connexion (${e.message}) « x »`, a: "connexion", b: \'connexion\' }, 500)'))
      .toBe('json({ error:  e.message , a: , b:  }, 500)')
  })

  const acces = GESTIONNAIRE.indexOf('rpc("admin_du_dossier"')

  it('l’accès au dossier se vérifie AVANT toute lecture de la connexion et tout appel à la plateforme', () => {
    expect(acces).toBeGreaterThan(-1)
    for (const appel of ['.from("connexions_plateformes")', 'clientPlateforme(', 'plateforme.jeton()', 'plateforme.appelJson(', 'plateforme.fichier(']) {
      const position = GESTIONNAIRE.indexOf(appel)
      expect(position, `${appel} introuvable dans le gestionnaire`).toBeGreaterThan(-1)
      expect(position, `${appel} précède le contrôle d’accès`).toBeGreaterThan(acces)
    }
  })

  it('l’accès se lit avec le jeton de l’APPELANT, sur une session vérifiée, et son échec refuse', () => {
    expect(GESTIONNAIRE.indexOf('await supabaseAsCaller.auth.getUser()')).toBeLessThan(acces)
    expect(GESTIONNAIRE).toMatch(/const \{ data: aAcces, error: erreurAcces \} = await supabaseAsCaller\.rpc\("admin_du_dossier", \{ p_dossier_id: dossierId \}\)/)
    expect(GESTIONNAIRE).toMatch(/if \(erreurAcces\) return json\(/)
    expect(GESTIONNAIRE).toMatch(/if \(!aAcces\) return json\(\{ error: "Dossier introuvable\." \}, 404\)/)
  })

  it('« statut », « retirer » et « enregistrer » ne parlent pas à la plateforme ; « statut » ne rend que la vue publique', () => {
    const premierAppel = GESTIONNAIRE.indexOf('clientPlateforme(')
    for (const action of ['statut', 'retirer', 'enregistrer', 'retenir']) {
      const branche = brancheDe(action)
      expect(branche, action).not.toMatch(/plateforme\.|clientPlateforme\(|fetch\(/)
      expect(GESTIONNAIRE.indexOf(branche), action).toBeLessThan(premierAppel)
    }
    expect(brancheDe('statut')).toBe('if (action === "statut") {\n    return json({ connexion: vuePublique(connexion) })\n  }')
  })

  it('tout le réseau passe par le client de la plateforme : un seul `fetch`, que les redirections ne suivent pas', () => {
    expect(SOURCE.match(/\bfetch\(/g)).toHaveLength(1)
    expect(GESTIONNAIRE).toContain('clientPlateforme(connexion, (url, init) => fetch(url, init), {')
    expect(bloc('HTTP')).toContain('redirect: "manual", signal: AbortSignal.timeout(options.delaiMs)')
  })

  it('une configuration modifiée entre la liste et l’import refuse le téléchargement et le point de reprise', () => {
    const controle = GESTIONNAIRE.indexOf('const versionPerimee = (action === "telecharger" || action === "retenir") && payload.version !== connexion.updated_at')
    expect(controle).toBeGreaterThan(-1)
    expect(GESTIONNAIRE.indexOf('if (action === "retenir") {')).toBeGreaterThan(controle)
    expect(GESTIONNAIRE.indexOf('plateforme.fichier(')).toBeGreaterThan(controle)
    // Et le point de reprise ne s'écrit que sur la configuration lue.
    expect(brancheDe('retenir')).toContain('.eq("dossier_id", dossierId).eq("updated_at", connexion.updated_at)')
  })

  it('une autre plateforme, une autre identité ou une autre entreprise remet la recherche au début', () => {
    expect(brancheDe('enregistrer')).toContain('...(saisie.reinitialiser ? { recherche_depuis: null, derniere_recuperation: null } : {})')
  })

  it('ce que la facture EST se relit chez la plateforme avant de télécharger le document', () => {
    const meta = GESTIONNAIRE.indexOf('`${chemin}?docType=Metadata`')
    const document = GESTIONNAIRE.indexOf('plateforme.fichier(')
    expect(meta).toBeGreaterThan(-1)
    expect(document).toBeGreaterThan(meta)
    // Chaque contrôle doit EXISTER avant d'être à sa place : un `indexOf` à -1 passerait pour « avant tout ».
    const ecarte = GESTIONNAIRE.indexOf('if ("ecarte" in lu || lu.flux.id !== flowId)')
    const pret = GESTIONNAIRE.indexOf('if (lu.flux.etat !== "pret")')
    expect(ecarte).toBeGreaterThan(meta)
    expect(pret).toBeGreaterThan(meta)
    expect(pret).toBeLessThan(document)
    // Et la nature des octets rendus doit être celle que le format annonce.
    expect(GESTIONNAIRE).toContain('const attendue = document === "lisible" || lu.flux.syntaxe === "Factur-X" ? "pdf" : "xml"')
    const nature = GESTIONNAIRE.indexOf('if (nature !== attendue) {')
    expect(nature).toBeGreaterThan(document)
    expect(nature).toBeLessThan(GESTIONNAIRE.indexOf('contenu: base64De('))
  })

  it('aucune réponse ne porte le secret ni le jeton', () => {
    let n = 0
    for (let i = GESTIONNAIRE.indexOf('json('); i > -1; i = GESTIONNAIRE.indexOf('json(', i + 1)) {
      const appel = appelA(GESTIONNAIRE, i)
      n++
      // Seul le CODE de l'appel compte : « La connexion à la plateforme… » ou « le secret » dans un message ne sont
      // pas l'objet ni sa valeur.
      const code = codeSeul(appel)
      expect(code, appel.slice(0, 80)).not.toMatch(/secret|acces\.jeton|jetonObtenu|access_token/)
      // La connexion lue ne sort que par sa vue publique, ou champ par champ — jamais l'objet entier. Une CLÉ nommée
      // « connexion » n'est pas l'objet ; un `? connexion :` le serait, et reste attrapé.
      const sansVue = code.replace(/vuePublique\((?:[^()]|\([^()]*\))*\)/g, '').replace(/\bconnexion\.\w+/g, '')
        .replace(/([{,]\s*)connexion\s*:/g, '$1')
      expect(sansVue, appel.slice(0, 80)).not.toMatch(/\bconnexion\b|\blue\b|\bdata\b/)
    }
    // Le plancher : sans lui, un balayage devenu aveugle passerait cette règle à vide.
    expect(n).toBeGreaterThan(30)
  })

  /** Les expressions `${…}` d'un gabarit, accolades appariées — une expression peut en porter. */
  function expressionsInserees(texte: string): string[] {
    const expressions: string[] = []
    for (let i = texte.indexOf('${'); i > -1; i = texte.indexOf('${', i + 2)) {
      let profondeur = 0
      for (let k = i + 1; k < texte.length; k++) {
        if (texte[k] === '{') profondeur++
        else if (texte[k] === '}') {
          profondeur--
          if (profondeur === 0) { expressions.push(texte.slice(i + 2, k)); break }
        }
      }
    }
    return expressions
  }

  it('l’extraction des expressions insérées apparie les accolades — sans quoi elle couperait une expression à la première', () => {
    expect(expressionsInserees('`a ${(e as { name?: unknown })?.name ?? "?"} b ${x.length}`'))
      .toEqual(['(e as { name?: unknown })?.name ?? "?"', 'x.length'])
  })

  it('les journaux ne portent que des nombres et des codes de retour', () => {
    const journaux = [...SOURCE.matchAll(/console\.(?:log|error|warn)\(/g)].map((m) => appelA(SOURCE, m.index!))
    expect(journaux.length).toBeGreaterThan(5)
    for (const j of journaux) {
      const inserees = expressionsInserees(j).map((e) => e.replace(/\b\w+(\.\w+)*\.length\b/g, ''))
      for (const expression of inserees) {
        expect(expression, j).toMatch(/^\s*(action|[\w.]*statut|document|recherche\.pages|\(e as \{ name\?: unknown \}\)\?\.name \?\? "\?"|Object\.values\(recherche\.ecartes\)\.reduce\(\(a, b\) => a \+ b, 0\)|recherche\.complete \? "complet" : "incomplet")?\s*$/)
      }
      const horsTexte = j.slice(j.indexOf('(') + 1, -1).replace(/`(?:\\.|\$\{[^}]*(?:\{[^}]*\}[^}]*)*\}|[^`\\])*`|"(?:\\.|[^"\\])*"/g, '')
      expect(horsTexte.replace(/[\s+]/g, ''), j).toBe('')
    }
  })

  it('la recherche ne demande que des factures, cent par page, depuis le point de reprise lu', () => {
    expect(SOURCE).toContain('const TYPES_RECHERCHES = ["SupplierInvoice", "CustomerInvoice"]')
    expect(SOURCE).toMatch(/const TAILLE_PAGE = 100\n/)
    expect(brancheDe('lister')).toContain('where: { flowType: TYPES_RECHERCHES, ...(demande.updatedAfter ? { updatedAfter: demande.updatedAfter } : {}) }')
    expect(brancheDe('lister')).toContain('const depuis = instantMs(connexion.recherche_depuis)')
  })

  it('la fonction exige une session à la passerelle (`verify_jwt = true`) : aucun appelant n’en est dépourvu', () => {
    expect(CONFIG).toMatch(/\[functions\.plateforme-agreee\]\nverify_jwt = true\n/)
  })
})
