import { readFileSync, readdirSync } from 'node:fs'
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthWeakPasswordError } from '@supabase/supabase-js'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  ADRESSE_DE_RETOUR, AVIS_LIEN_SANS_SESSION, LONGUEUR_MINIMALE_MOT_DE_PASSE, REGLE_DU_MOT_DE_PASSE, SORTES_DE_CARACTERES,
  adresseDejaInscrite, avisDuLienEnvoye, avisDuRefus, lireRetourDuLien, messageErreurDuLien, messageErreurDuLienEnvoye,
  messageErreurDuMotDePasse, questionDuLienEnvoye, refusDeLaRegle, refusDuMotDePasse, refusDuNouveauMotDePasse,
} from './recuperationMotDePasse'
import {
  LONGUEUR_MAXIMALE_EN_OCTETS, MESSAGE_RELEVE_LE_10_10_2026, REGLE_DU_PROJET_RELEVEE, jeuxDuMessage, jugementDuService,
} from '../test/regleDuService'

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
  it('la règle du projet : dix caractères au moins, et les quatre sortes', () => {
    expect(refusDuNouveauMotDePasse('a'.repeat(9), 'a'.repeat(9))).toBe(
      'Ce mot de passe ne suit pas la règle du projet : il doit faire au moins 10 caractères, et contenir une majuscule, un chiffre et un symbole.',
    )
    expect(refusDuNouveauMotDePasse('Abcdefgh1!', 'Abcdefgh1!')).toBeNull()
  })

  it('deux saisies identiques', () => {
    expect(refusDuNouveauMotDePasse('Mot-de-passe-1', 'Mot-de-passe-2')).toBe('Les deux saisies ne sont pas identiques.')
    // La règle se dit d'abord : c'est elle qu'on corrige en premier.
    expect(refusDuNouveauMotDePasse('court', 'autre')).toBe(
      'Ce mot de passe ne suit pas la règle du projet : il doit faire au moins 10 caractères, et contenir une majuscule, un chiffre et un symbole.',
    )
  })

  it('la longueur est celle de la création des comptes, dans les trois fonctions qui en créent', () => {
    for (const fonction of ['create-client-access', 'create-team-member', 'create-cabinet']) {
      const source = readFileSync(racine(`supabase/functions/${fonction}/index.ts`), 'utf8')
      expect([...source.matchAll(/password\.length < (\d+)/g)].map((m) => Number(m[1])), fonction).toEqual([LONGUEUR_MINIMALE_MOT_DE_PASSE])
    }
  })
})

// LA RÈGLE DES MOTS DE PASSE DU PROJET (défaut 23.5, 10/10/2026) : un REFLET de celle du tableau de bord, que les quatre
// écrans qui posent un mot de passe disent avant le clic et appliquent avant tout appel. Le service reste juge : ce
// reflet se confronte à son refus relevé en production, et à un modèle de ce qu'il fait (`src/test/regleDuService.ts`).
describe('la règle des mots de passe du projet, reflet du tableau de bord', () => {
  // Les 32 signes de ponctuation de l'ASCII, calculés ici sans rien recopier : ce que « un symbole » couvre chez le service.
  const PONCTUATION = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i)).filter((c) => !/[a-z0-9]/i.test(c))

  it('les sortes de caractères sont celles que le service a listées en production, jeu pour jeu', () => {
    expect(SORTES_DE_CARACTERES.map((s) => s.caracteres)).toEqual(jeuxDuMessage(MESSAGE_RELEVE_LE_10_10_2026))
    expect(SORTES_DE_CARACTERES.map((s) => s.sorte)).toEqual(['une minuscule', 'une majuscule', 'un chiffre', 'un symbole'])
    // « Un symbole », pour le service : les 32 signes de ponctuation de l'ASCII, ni plus ni moins.
    expect(PONCTUATION).toHaveLength(32)
    expect([...SORTES_DE_CARACTERES[3].caracteres].sort()).toEqual([...PONCTUATION].sort())
  })

  it('la phrase des écrans dit la longueur, les quatre sortes, chaque symbole, et ce qui ne compte pas', () => {
    expect(REGLE_DU_MOT_DE_PASSE).toBe(
      'Règle du projet : au moins 10 caractères, dont une minuscule, une majuscule, un chiffre et un symbole — l\'un de '
      + '! @ # $ % ^ & * ( ) _ + - = [ ] { } ; \' \\ : " | < > ? , . / ` ~ (une lettre accentuée, « € » ou l\'espace ne '
      + 'comptent pas).',
    )
    for (const c of PONCTUATION) expect(REGLE_DU_MOT_DE_PASSE, c).toContain(` ${c} `)
  })

  it('ce qui manque se dit d’un coup, dans l’ordre de la phrase', () => {
    const tete = 'Ce mot de passe ne suit pas la règle du projet : il doit '
    expect(refusDeLaRegle('')).toBe(`${tete}faire au moins 10 caractères, et contenir une minuscule, une majuscule, un chiffre et un symbole.`)
    expect(refusDeLaRegle('1234567890')).toBe(`${tete}contenir une minuscule, une majuscule et un symbole.`)
    expect(refusDeLaRegle('motdepassesimple')).toBe(`${tete}contenir une majuscule, un chiffre et un symbole.`)
    expect(refusDeLaRegle('Motdepasse12')).toBe(`${tete}contenir un symbole.`)
    expect(refusDeLaRegle('Mdp-1')).toBe(`${tete}faire au moins 10 caractères.`)
    expect(refusDeLaRegle('MOT-DE-PASSE-1')).toBe(`${tete}contenir une minuscule.`)
    expect(refusDeLaRegle('mot-de-passe-1')).toBe(`${tete}contenir une majuscule.`)
    expect(refusDeLaRegle('Mot-de-passe')).toBe(`${tete}contenir un chiffre.`)
    // Dix caractères tout juste, chaque sorte présente : la règle est suivie ; neuf, elle ne l'est plus.
    expect(refusDeLaRegle('Abcdefgh1!')).toBeNull()
    expect(refusDeLaRegle('Abcdefg1!')).toBe(`${tete}faire au moins 10 caractères.`)
  })

  it('une lettre accentuée, « € », « § » et l’espace ne font aucune sorte — comme chez le service', () => {
    const tete = 'Ce mot de passe ne suit pas la règle du projet : il doit '
    expect(refusDeLaRegle('Motdepasse1€')).toBe(`${tete}contenir un symbole.`)
    expect(refusDeLaRegle('Mot de passe 1')).toBe(`${tete}contenir un symbole.`)
    expect(refusDeLaRegle('Mötdepässe1§')).toBe(`${tete}contenir un symbole.`)
    expect(refusDeLaRegle('ÉTÉ-À-PARIS-1')).toBe(`${tete}contenir une minuscule.`)
    for (const c of PONCTUATION) expect(refusDeLaRegle(`Motdepasse1${c}`), c).toBeNull()
  })

  // Le reflet ne laisse JAMAIS partir ce que le service refuserait sous la règle relevée (le pire sens : le cabinet lirait
  // le refus du service après le clic, au lieu de celui de l'écran avant). Sur l'ASCII, il dit exactement la même chose ;
  // hors de l'ASCII il peut être plus strict — il compte des caractères, le service des octets — jamais moins.
  it('hors de l’ASCII, l’écran compte des caractères et le service des octets : l’écran peut être plus strict, jamais moins', () => {
    // Neuf caractères, quatorze octets : l'écran le refuse, le service l'admettrait.
    expect('éééééAa1!'.length).toBe(9)
    expect(refusDeLaRegle('éééééAa1!')).toBe('Ce mot de passe ne suit pas la règle du projet : il doit faire au moins 10 caractères.')
    expect(jugementDuService('éééééAa1!', REGLE_DU_PROJET_RELEVEE)).toEqual({ admis: true })
  })

  it('le reflet ne laisse partir aucun mot de passe que le service refuserait, sur une grille de mille mots de passe', () => {
    const morceaux = ['a', 'Z', '7', '!', '~', ' ', 'é', '€', '😀', 'ß', '\t', 'xy', 'Q9', '-_']
    const grille: string[] = []
    for (let n = 0; n < 1000; n++) {
      // Un tirage déterministe : le n-ième mot de passe s'écrit en base 14 sur ses morceaux.
      let mdp = ''
      for (let k = n + 1; k > 0; k = Math.floor(k / 14)) mdp += morceaux[k % 14]
      grille.push(mdp, `${mdp}${mdp}`, `Base-1${mdp}`)
    }
    let ascii = 0
    let admis = 0
    for (const mdp of grille) {
      const service = jugementDuService(mdp, REGLE_DU_PROJET_RELEVEE)
      if (new TextEncoder().encode(mdp).length > LONGUEUR_MAXIMALE_EN_OCTETS) continue
      if (refusDeLaRegle(mdp) === null) {
        admis++
        expect(service, mdp).toEqual({ admis: true })
      }
      if (/^[\x20-\x7e]*$/.test(mdp)) {
        ascii++
        expect(refusDeLaRegle(mdp) === null, mdp).toBe(service.admis)
      }
    }
    // Plancher : la grille voit des deux côtés, et assez d'ASCII pour que l'égalité y dise quelque chose.
    expect(admis).toBeGreaterThan(300)
    expect(ascii).toBeGreaterThan(300)
    expect(grille.filter((m) => refusDeLaRegle(m) !== null).length).toBeGreaterThan(300)
  })
})

// LE BLOC refusDuService, recopié dans les trois fonctions qui créent des comptes (refusDuServiceCopie.test.ts garde les
// copies). Sur les VRAIES classes d'erreur d'auth-js, et sur des formes que le service ne rend pas.
describe('ce que le service d’authentification dit quand il refuse — lu à son code', () => {
  const DEJA = 'A user with this email address has already been registered'
  const tete = "Le service d'authentification refuse ce mot de passe : il ne suit pas la règle des mots de passe du projet, "
    + 'réglée au tableau de bord de Supabase'
  const COURT = 'il est trop court'
  const SORTES = "il lui manque une sorte de caractères qu'elle exige (minuscule, majuscule, chiffre ou symbole, selon le réglage)"
  const DIVULGUE = 'il figure parmi les mots de passe divulgués lors de fuites de données'
  const faible = (raisons: ('length' | 'characters' | 'pwned')[]) => new AuthWeakPasswordError('Password is too weak', 422, raisons)

  it('une adresse inscrite se reconnaît à ses deux codes, et à rien d’autre — ni au statut 422, ni au message', () => {
    expect(adresseDejaInscrite(new AuthApiError(DEJA, 422, 'email_exists'))).toBe(true)
    expect(adresseDejaInscrite(new AuthApiError('User already registered', 422, 'user_already_exists'))).toBe(true)
    expect(adresseDejaInscrite({ code: 'email_exists' })).toBe(true)
    // Le défaut 23.5 sous sa forme exacte : un mot de passe refusé, en 422.
    expect(adresseDejaInscrite(faible(['characters']))).toBe(false)
    expect(adresseDejaInscrite({ status: 422, message: DEJA })).toBe(false)
    expect(adresseDejaInscrite(new AuthApiError('Phone number already registered by another user', 422, 'phone_exists'))).toBe(false)
    expect(adresseDejaInscrite({ code: 'EMAIL_EXISTS' })).toBe(false)
    // Un code qui n'est pas un texte ne se convertit pas en texte : `['email_exists']` n'est pas `'email_exists'`.
    for (const rien of [null, undefined, 'email_exists', 422, {}, { code: 422 }, { code: ['email_exists'] }]) {
      expect(adresseDejaInscrite(rien), JSON.stringify(rien) ?? String(rien)).toBe(false)
    }
  })

  it('un mot de passe refusé se dit en français, chaque raison dans l’ordre du service', () => {
    expect(refusDuMotDePasse(faible(['length']))).toBe(`${tete} — ${COURT}.`)
    expect(refusDuMotDePasse(faible(['characters']))).toBe(`${tete} — ${SORTES}.`)
    expect(refusDuMotDePasse(faible(['pwned']))).toBe(`${tete} — ${DIVULGUE}.`)
    expect(refusDuMotDePasse(faible(['length', 'characters', 'pwned']))).toBe(`${tete} — ${COURT} ; ${SORTES} ; ${DIVULGUE}.`)
    // Rendues dans un autre ordre, ou deux fois : la phrase garde l'ordre du service, et chaque raison une fois.
    expect(refusDuMotDePasse(faible(['pwned', 'length']))).toBe(`${tete} — ${COURT} ; ${DIVULGUE}.`)
    expect(refusDuMotDePasse({ code: 'weak_password', reasons: ['characters', 'characters'] })).toBe(`${tete} — ${SORTES}.`)
  })

  it('sans raison lisible, la phrase de tête seule — une raison inconnue ne se recopie pas', () => {
    for (const reasons of [[], undefined, null, 'length', 42, ['inconnue'], ['LENGTH'], [['length']], ['<b>raison</b>']]) {
      expect(refusDuMotDePasse({ code: 'weak_password', reasons }), JSON.stringify(reasons)).toBe(`${tete}.`)
    }
    expect(refusDuMotDePasse({ code: 'weak_password', reasons: ['inconnue', 'pwned'] })).toBe(`${tete} — ${DIVULGUE}.`)
  })

  it('ce qui n’est pas un refus du mot de passe ne s’en dit pas un', () => {
    for (const erreur of [
      new AuthApiError(DEJA, 422, 'email_exists'), new AuthApiError('Password cannot be longer than 72 characters', 400, 'validation_failed'),
      { status: 422, reasons: ['length'] }, { code: 'Weak_Password', reasons: ['length'] }, { code: ['weak_password'], reasons: ['length'] },
      null, undefined, 'weak_password',
    ]) {
      expect(refusDuMotDePasse(erreur), JSON.stringify(erreur) ?? String(erreur)).toBeNull()
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
    // Le refus du mot de passe : la phrase même des trois fonctions qui créent des comptes, ce qui manque compris.
    expect(messageErreurDuMotDePasse(new AuthWeakPasswordError('Password is too weak', 422, ['characters']))).toBe(
      "Le service d'authentification refuse ce mot de passe : il ne suit pas la règle des mots de passe du projet, réglée au "
      + "tableau de bord de Supabase — il lui manque une sorte de caractères qu'elle exige (minuscule, majuscule, chiffre ou "
      + 'symbole, selon le réglage). Choisis-en un autre.',
    )
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
