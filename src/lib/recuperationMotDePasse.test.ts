import { readFileSync, readdirSync } from 'node:fs'
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthWeakPasswordError } from '@supabase/supabase-js'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  ADRESSE_DE_RETOUR, AVIS_LIEN_SANS_SESSION, LONGUEUR_MINIMALE_MOT_DE_PASSE, avisDuLienEnvoye, avisDuRefus, lireRetourDuLien,
  messageErreurDuLien, messageErreurDuLienEnvoye, messageErreurDuMotDePasse, questionDuLienEnvoye, refusDuNouveauMotDePasse,
} from './recuperationMotDePasse'

// Les adresses que le service d'authentification fabrique (supabase/auth) : `AsRedirectURL` ajoute les jetons après
// un « # » (et `sb`, sa marque) ; `prepErrorRedirectURL` met l'erreur dans le fragment en flux implicite. Le jeton est
// fictif.
const JETON = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LWNsaWVudCJ9.signature-fictive'
const lienDeRecuperation = (type = 'recovery') =>
  `${ADRESSE_DE_RETOUR}#access_token=${JETON}&expires_at=1791200000&expires_in=3600&refresh_token=rt-fictif&sb=&token_type=bearer&type=${type}`
const lienRefuse = `${ADRESSE_DE_RETOUR}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=`

const racine = (chemin: string) => new URL(`../../${chemin}`, import.meta.url)

describe('le retour d’un lien d’authentification, lu dans l’adresse du chargement', () => {
  it('un lien « Mot de passe oublié » rend son jeton', () => {
    expect(lireRetourDuLien(lienDeRecuperation())).toEqual({ nature: 'recuperation', jeton: JETON })
  })

  it('un lien refusé rend son code, jamais sa description', () => {
    expect(lireRetourDuLien(lienRefuse)).toEqual({ nature: 'refus', code: 'otp_expired' })
    // Sans `error_code`, le code est celui de `error`.
    expect(lireRetourDuLien(`${ADRESSE_DE_RETOUR}#error=access_denied&error_description=x`)).toEqual({ nature: 'refus', code: 'access_denied' })
    // Une description seule suffit à dire un refus, comme pour le client.
    expect(lireRetourDuLien(`${ADRESSE_DE_RETOUR}#error_description=Refus`)).toEqual({ nature: 'refus', code: null })
  })

  it('un code qui n’a pas la forme d’un code ne se recopie pas : une adresse se fabrique', () => {
    expect(lireRetourDuLien(`${ADRESSE_DE_RETOUR}#error_code=Appelez+le+0600000000`)).toEqual({ nature: 'refus', code: null })
    expect(lireRetourDuLien(`${ADRESSE_DE_RETOUR}#error_code=${'a'.repeat(41)}`)).toEqual({ nature: 'refus', code: null })
  })

  it('une erreur l’emporte sur un jeton, comme chez le client', () => {
    expect(lireRetourDuLien(`${lienDeRecuperation()}&error=server_error`).nature).toBe('refus')
  })

  it('une valeur vide ne fait pas un refus', () => {
    expect(lireRetourDuLien(`${ADRESSE_DE_RETOUR}#error=&error_code=&error_description=`)).toEqual({ nature: 'aucun' })
  })

  it('un autre lien, ou un jeton sans type, n’est pas une récupération', () => {
    expect(lireRetourDuLien(lienDeRecuperation('signup'))).toEqual({ nature: 'aucun' })
    expect(lireRetourDuLien(lienDeRecuperation('magiclink'))).toEqual({ nature: 'aucun' })
    expect(lireRetourDuLien(`${ADRESSE_DE_RETOUR}#access_token=${JETON}`)).toEqual({ nature: 'aucun' })
    expect(lireRetourDuLien(`${ADRESSE_DE_RETOUR}#type=recovery`)).toEqual({ nature: 'aucun' })
  })

  it('une route de l’application n’est jamais un retour, même quand elle porte une erreur de la banque', () => {
    expect(lireRetourDuLien(`${ADRESSE_DE_RETOUR}#/dossiers/d1/pieces`)).toEqual({ nature: 'aucun' })
    // Le retour de la banque (public/retour-banque.html) recopie ses paramètres derrière « #/retour-banque? » : lu comme
    // un fragment de paramètres, `error` y deviendrait une clé.
    expect(lireRetourDuLien(`${ADRESSE_DE_RETOUR}#/retour-banque?state=etat-fictif&error=access_denied`)).toEqual({ nature: 'aucun' })
  })

  it('une adresse sans fragment, ou illisible, ne rapporte rien', () => {
    expect(lireRetourDuLien(ADRESSE_DE_RETOUR)).toEqual({ nature: 'aucun' })
    expect(lireRetourDuLien(`${ADRESSE_DE_RETOUR}#`)).toEqual({ nature: 'aucun' })
    expect(lireRetourDuLien('pas une adresse')).toEqual({ nature: 'aucun' })
  })
})

describe('ce qu’un lien refusé se dit', () => {
  it('expiré ou déjà servi, pour `otp_expired` comme sans code', () => {
    const attendu = 'Ce lien ne peut plus servir : il a expiré, ou il a déjà été utilisé.'
    expect(avisDuRefus('otp_expired')).toBe(attendu)
    expect(avisDuRefus(null)).toBe(attendu)
  })

  it('un autre refus se dit avec son code', () => {
    expect(avisDuRefus('access_denied')).toBe("Ce lien a été refusé par le service d'authentification (code access_denied).")
  })

  it('un lien dont le jeton n’a ouvert aucune session', () => {
    expect(AVIS_LIEN_SANS_SESSION).toBe("Ce lien n'a pas pu ouvrir de session : il a peut-être expiré, ou le service n'a pas répondu.")
  })
})

describe('le nouveau mot de passe, jugé avant tout appel', () => {
  it('au moins dix caractères', () => {
    expect(refusDuNouveauMotDePasse('a'.repeat(9), 'a'.repeat(9))).toBe('Le mot de passe doit faire au moins 10 caractères.')
    expect(refusDuNouveauMotDePasse('a'.repeat(10), 'a'.repeat(10))).toBeNull()
  })

  it('deux saisies identiques', () => {
    expect(refusDuNouveauMotDePasse('mot-de-passe-1', 'mot-de-passe-2')).toBe('Les deux saisies ne sont pas identiques.')
    // La longueur se dit d'abord : c'est la règle qu'on corrige en premier.
    expect(refusDuNouveauMotDePasse('court', 'autre')).toBe('Le mot de passe doit faire au moins 10 caractères.')
  })

  it('la longueur est celle de la création des comptes, dans les trois fonctions qui en créent', () => {
    for (const fonction of ['create-client-access', 'create-team-member', 'create-cabinet']) {
      const source = readFileSync(racine(`supabase/functions/${fonction}/index.ts`), 'utf8')
      expect([...source.matchAll(/password\.length < (\d+)/g)].map((m) => Number(m[1])), fonction).toEqual([LONGUEUR_MINIMALE_MOT_DE_PASSE])
    }
  })
})

describe('l’adresse de retour', () => {
  it('est la racine du site, sur le domaine de public/CNAME, sans fragment', () => {
    const domaine = readFileSync(racine('public/CNAME'), 'utf8').trim()
    const url = new URL(ADRESSE_DE_RETOUR)
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe(domaine)
    expect(url.pathname).toBe('/')
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
    // Couverte par l'URL de retour autorisée au tableau de bord (`https://compta.jdarnis.fr/**`).
    expect(ADRESSE_DE_RETOUR.startsWith(`https://${domaine}/`)).toBe(true)
  })
})

describe('les erreurs du service, dites en français', () => {
  it('la demande de lien : le débit, sous son statut comme sous ses codes', () => {
    const trop = 'Trop de demandes en peu de temps : attends quelques minutes avant de redemander un lien.'
    expect(messageErreurDuLien(new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'))).toBe(trop)
    expect(messageErreurDuLien(new AuthApiError('For security purposes, you can only request this after 42 seconds.', 429, undefined))).toBe(trop)
    expect(messageErreurDuLien({ message: 'x', code: 'over_request_rate_limit' })).toBe(trop)
  })

  it('la demande de lien : une adresse invalide, le réseau, et le reste avec le message du service', () => {
    expect(messageErreurDuLien(new AuthApiError('Unable to validate email address: invalid format', 400, 'email_address_invalid')))
      .toBe("Cette adresse e-mail n'est pas valide.")
    expect(messageErreurDuLien(new AuthRetryableFetchError('Failed to fetch', 0)))
      .toBe("Le service de connexion n'a pas répondu : vérifie la connexion à Internet, puis réessaie.")
    // Un SMTP mal réglé répond 500 : auth-js en fait une erreur « à réessayer » de statut 500, et son message se dit.
    expect(messageErreurDuLien(new AuthRetryableFetchError('Error sending recovery email', 500)))
      .toBe("Le lien n'a pas pu être demandé : Error sending recovery email")
    expect(messageErreurDuLien(undefined)).toBe("Le lien n'a pas pu être demandé : raison inconnue")
  })

  it('le nouveau mot de passe : chaque refus connu, puis le message du service', () => {
    expect(messageErreurDuMotDePasse(new AuthApiError('New password should be different from the old password.', 422, 'same_password')))
      .toBe("C'est déjà le mot de passe de ce compte : choisis-en un autre.")
    expect(messageErreurDuMotDePasse(new AuthWeakPasswordError('Password is too weak', 422, ['characters'])))
      .toMatch(/^Le service d'authentification refuse ce mot de passe comme trop faible/)
    const expiree = "La session ouverte par le lien a expiré : déconnecte-toi, puis redemande un lien depuis l'écran de connexion."
    expect(messageErreurDuMotDePasse(new AuthSessionMissingError())).toBe(expiree)
    expect(messageErreurDuMotDePasse(new AuthApiError('invalid JWT', 403, 'bad_jwt'))).toBe(expiree)
    expect(messageErreurDuMotDePasse(new AuthApiError('Session expired', 401, 'session_expired'))).toBe(expiree)
    expect(messageErreurDuMotDePasse(new AuthApiError('Too many requests', 429, 'over_request_rate_limit')))
      .toBe('Trop de demandes en peu de temps : attends quelques minutes, puis réessaie.')
    expect(messageErreurDuMotDePasse(new AuthRetryableFetchError('Load failed', 0)))
      .toBe("Le service de connexion n'a pas répondu : vérifie la connexion à Internet, puis réessaie.")
    expect(messageErreurDuMotDePasse(new AuthApiError('Password cannot be longer than 72 characters', 422, 'validation_failed')))
      .toBe("Le mot de passe n'a pas pu être changé : Password cannot be longer than 72 characters")
  })
})

// LE LIEN ENVOYÉ PAR LE CABINET depuis l'onglet Accès (décision du cabinet du 10/10/2026) : le même lien, dont les mots,
// eux, peuvent nommer l'adresse — celle d'un accès que le cabinet a créé.
describe('le lien envoyé par le cabinet : ce qui se dit', () => {
  const adresse = 'client@exemple.fr'

  it('la question nomme l’adresse, et dit que le mot de passe actuel reste valable', () => {
    expect(questionDuLienEnvoye(adresse)).toBe(
      'Envoyer à client@exemple.fr un lien pour choisir un nouveau mot de passe ? '
      + "Le mot de passe actuel reste valable tant que le client n'en a pas choisi un autre par ce lien.",
    )
  })

  it('le succès dit vers quelle adresse le lien est parti, sans durée (réglée hors du dépôt)', () => {
    expect(avisDuLienEnvoye(adresse)).toBe("Un lien de réinitialisation est parti vers client@exemple.fr. Il ne sert qu'une fois.")
    expect(avisDuLienEnvoye(adresse)).not.toMatch(/heure|minute|expire/)
  })

  it('le débit du service se dit en français, sous son statut comme sous ses deux codes, et dit que rien n’est parti', () => {
    const trop = 'Trop de demandes rapprochées : le service d\'authentification n\'a pas envoyé de nouveau lien vers client@exemple.fr. '
      + "Un lien vient peut-être d'y partir ; sinon, attends quelques minutes, puis réessaie."
    expect(messageErreurDuLienEnvoye(adresse, new AuthApiError('For security purposes, you can only request this after 42 seconds.', 429, undefined))).toBe(trop)
    expect(messageErreurDuLienEnvoye(adresse, new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'))).toBe(trop)
    expect(messageErreurDuLienEnvoye(adresse, { message: 'x', code: 'over_email_send_rate_limit' })).toBe(trop)
    expect(messageErreurDuLienEnvoye(adresse, { message: 'x', code: 'over_request_rate_limit' })).toBe(trop)
  })

  it('une adresse refusée, le réseau muet (on ne sait pas si le lien est parti), puis le message du service', () => {
    expect(messageErreurDuLienEnvoye(adresse, new AuthApiError('Unable to validate email address: invalid format', 400, 'email_address_invalid')))
      .toBe("Le service d'authentification refuse l'adresse client@exemple.fr comme invalide : aucun lien n'est parti.")
    expect(messageErreurDuLienEnvoye(adresse, new AuthRetryableFetchError('Failed to fetch', 0))).toBe(
      "Le service de connexion n'a pas répondu : on ne sait pas si le lien est parti vers client@exemple.fr. "
      + 'Vérifie la connexion à Internet, puis réessaie.',
    )
    // Un SMTP mal réglé : statut 500, « à réessayer » mais avec une réponse — son message se dit.
    expect(messageErreurDuLienEnvoye(adresse, new AuthRetryableFetchError('Error sending recovery email', 500)))
      .toBe("Le lien n'a pas pu partir vers client@exemple.fr : Error sending recovery email")
    // Une erreur qui n'est pas une `Error` (objet nu) passe par `messageErreur`, comme toutes.
    expect(messageErreurDuLienEnvoye(adresse, { message: 'refus du service' }))
      .toBe("Le lien n'a pas pu partir vers client@exemple.fr : refus du service")
    expect(messageErreurDuLienEnvoye(adresse, undefined)).toBe("Le lien n'a pas pu partir vers client@exemple.fr : raison inconnue")
  })
})

// « redirectTo toujours passé, jamais construit à part » : chaque demande de lien de la source passe
// `{ redirectTo: ADRESSE_DE_RETOUR }`, la constante importée de CE module. Sans `redirectTo`, le service retombe sur la
// « Site URL » du tableau de bord ; avec une adresse écrite ailleurs, deux écrans enverraient deux liens différents. Lu sur
// l'EXPRESSION (l'arbre de TypeScript), jamais sur la ligne.
interface AppelDuLien { chemin: string; faute: string | null }

function appelsDuLien(sources: { chemin: string; texte: string }[]): AppelDuLien[] {
  const sortie: AppelDuLien[] = []
  for (const { chemin, texte } of sources) {
    const sf = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, chemin.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    // L'adresse de retour doit venir de ce module, sous son nom (un alias pourrait nommer n'importe quoi).
    const importee = sf.statements.some((s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)
      && /(^|\/)recuperationMotDePasse$/.test(s.moduleSpecifier.text)
      && s.importClause?.namedBindings !== undefined && ts.isNamedImports(s.importClause.namedBindings)
      && s.importClause.namedBindings.elements.some((e) => e.name.text === 'ADRESSE_DE_RETOUR' && e.propertyName === undefined))
    const visiter = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && n.name.text === 'resetPasswordForEmail') {
        const appel = n.parent
        let faute: string | null = null
        if (!ts.isCallExpression(appel) || appel.expression !== n) faute = 'méthode prise sans être appelée'
        else {
          const options = appel.arguments[1]
          const propriete = options && ts.isObjectLiteralExpression(options) && options.properties.length === 1
            ? options.properties[0] : null
          if (!propriete || !ts.isPropertyAssignment(propriete) || propriete.name.getText(sf) !== 'redirectTo'
            || !ts.isIdentifier(propriete.initializer) || propriete.initializer.text !== 'ADRESSE_DE_RETOUR') {
            faute = `options « ${options ? options.getText(sf) : 'absentes'} »`
          } else if (!importee) faute = 'ADRESSE_DE_RETOUR non importée de recuperationMotDePasse'
        }
        sortie.push({ chemin, faute })
      }
      ts.forEachChild(n, visiter)
    }
    visiter(sf)
  }
  return sortie
}

function sourcesDeProduction(): { chemin: string; texte: string }[] {
  const sortie: { chemin: string; texte: string }[] = []
  ;(function parcourir(dossier: string) {
    for (const e of readdirSync(racine(dossier), { withFileTypes: true })) {
      const chemin = `${dossier}${e.name}`
      if (e.isDirectory()) { if (chemin !== 'src/test') parcourir(`${chemin}/`) }
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) sortie.push({ chemin, texte: readFileSync(racine(chemin), 'utf8') })
    }
  })('src/')
  return sortie
}

describe('chaque demande de lien de la source revient à l’adresse de retour de ce module', () => {
  it('l’écran de connexion et l’onglet Accès, et eux seuls, demandent le lien — avec `{ redirectTo: ADRESSE_DE_RETOUR }`', () => {
    const sources = sourcesDeProduction()
    // Plancher : sans lui, « aucune faute » se confondrait avec « aucun fichier lu ».
    expect(sources.length).toBeGreaterThan(180)
    const appels = appelsDuLien(sources)
    expect(appels).toEqual([
      { chemin: 'src/pages/Login.tsx', faute: null },
      { chemin: 'src/pages/dossier/AccesTab.tsx', faute: null },
    ])
  })

  it('le garde voit une adresse écrite à part, des options absentes ou étalées, une constante d’ailleurs', () => {
    const avecImport = (corps: string) => `import { ADRESSE_DE_RETOUR } from '../lib/recuperationMotDePasse'\n${corps}`
    const fautes = appelsDuLien([
      { chemin: 'a.ts', texte: avecImport("supabase.auth.resetPasswordForEmail(a, { redirectTo: 'https://ailleurs.example/' })") },
      { chemin: 'b.ts', texte: avecImport('supabase.auth.resetPasswordForEmail(a)') },
      { chemin: 'c.ts', texte: avecImport('supabase.auth.resetPasswordForEmail(a, { ...options })') },
      { chemin: 'd.ts', texte: avecImport('supabase.auth.resetPasswordForEmail(a, { redirectTo: ADRESSE_DE_RETOUR, captchaToken: x })') },
      { chemin: 'e.ts', texte: "import { ADRESSE_DE_RETOUR } from './ailleurs'\nsupabase.auth.resetPasswordForEmail(a, { redirectTo: ADRESSE_DE_RETOUR })" },
      { chemin: 'f.ts', texte: "import { AUTRE as ADRESSE_DE_RETOUR } from './recuperationMotDePasse'\nsupabase.auth.resetPasswordForEmail(a, { redirectTo: ADRESSE_DE_RETOUR })" },
      { chemin: 'g.ts', texte: avecImport('const demander = supabase.auth.resetPasswordForEmail') },
      { chemin: 'h.tsx', texte: avecImport('await supabase.auth\n  .resetPasswordForEmail(\n    a,\n    { redirectTo: ADRESSE_DE_RETOUR },\n  )') },
      { chemin: 'i.ts', texte: avecImport('supabase.auth.resetPasswordForEmail(a, { emailRedirectTo: ADRESSE_DE_RETOUR })') },
    ])
    expect(fautes.map((f) => [f.chemin, f.faute === null])).toEqual([
      ['a.ts', false], ['b.ts', false], ['c.ts', false], ['d.ts', false], ['e.ts', false], ['f.ts', false], ['g.ts', false],
      // Coupée sur cinq lignes, l'expression reste juste : le garde ne lit pas la ligne.
      ['h.tsx', true],
      // La bonne constante sous une autre option : `resetPasswordForEmail` ne lit que `redirectTo`.
      ['i.ts', false],
    ])
  })
})
