import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

// QUI PEUT FAIRE LIRE UN DOCUMENT AU FRAIS DU CABINET ?
//
// `extract-piece` lit un fichier par Textract puis fait citer ses champs par un modèle : chaque appel
// est facturé sur le compte AWS du cabinet. Jusqu'au 25/09/2026 elle ne demandait qu'un jeton SIGNÉ
// (`verify_jwt`), et la clé publique de l'application en est un, servie à tout visiteur avec le code
// du site. N'importe qui pouvait donc lui faire lire des fichiers de 10 Mo en boucle. Ce n'était pas
// une fuite de données — la fonction ne lit ni n'écrit rien en base —, c'était une facture ouverte.
//
// Et une session VALIDE ne suffisait pas non plus : l'inscription publique est ouverte sur ce projet,
// donc la clé publique et une adresse jetable en donnent une. Il faut un compte RATTACHÉ — chef,
// membre d'équipe, client d'un dossier ou super-admin (`estRattache`).
//
// Quatre questions, et aucune ne suffit seule :
//   1. Le contrôle REFUSE-t-il ce qu'il doit refuser, et accepte-t-il ce qu'il doit accepter ? On
//      l'EXÉCUTE, extrait de la vraie source entre ses bornes et transpilé par le compilateur du
//      projet — l'idiome d'`extractPiecePagination`, appliqué à une barrière.
//   2. Le rattachement dit-il vrai, y compris quand une de ses lectures échoue ? Exécuté de même.
//   3. Tout cela est-il câblé AVANT toute dépense, sur les TROIS tables ? Un contrôle parfait posé
//      après la lecture Textract laisserait la facture entière passer, et une table oubliée
//      refuserait sa lecture à toute une famille d'utilisateurs — les clients, si c'est `memberships`.
//   4. Le seul appelant sans session, `receive-email`, parle-t-il encore la langue que le contrôle
//      attend ? S'il changeait de clé, ses pièces jointes arriveraient sans lecture, en silence — la
//      panne qui ressemble à un dossier calme.

const SOURCE = readFileSync(
  new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')
const SOURCE_RECEPTION = readFileSync(
  new URL('../../supabase/functions/receive-email/index.ts', import.meta.url), 'utf8')

type SessionRattachee = (jeton: string) => Promise<boolean>
type Controle = (entete: string | null, cleService: string | undefined, sessionRattachee: SessionRattachee) => Promise<boolean>
type Comptage = { count: number | null; error: { message: string } | null }
type Rattachement = (comptes: Comptage[]) => boolean

function blocAppelant(source: string): string {
  const debut = source.indexOf('// ── DÉBUT APPELANT')
  const fin = source.indexOf('// ── FIN APPELANT')
  expect(debut, 'bornes du contrôle d’appelant introuvables — garde-fou à remettre à jour').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  const bloc = source.slice(debut, fin)
  expect(bloc, '`appelantAutorise` absente du bloc gardé').toContain('async function appelantAutorise(')
  expect(bloc, '`estRattache` absente du bloc gardé').toContain('function estRattache(')
  return bloc
}

/** Le bloc SEUL, transpilé et exécuté : tout nom qu'il emprunterait au reste du fichier lèverait. */
function executer(bloc: string): { appelantAutorise: Controle; estRattache: Rattachement } {
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { appelantAutorise, estRattache }`)()
}

const { appelantAutorise, estRattache } = executer(blocAppelant(SOURCE))

const CLE_SERVICE = 'cle-de-service-du-projet'
const CLE_PUBLIQUE = 'cle-publique-servie-avec-le-site'
const SESSION = 'jeton-d-une-session-ouverte'

/** Le service d'authentification simulé : il ne reconnaît qu'une session, et compte ses appels. */
function authentification() {
  return vi.fn(async (jeton: string) => jeton === SESSION)
}

describe('extract-piece — qui peut faire lire un document', () => {
  it('refuse un appel sans en-tête, sans même interroger le service d’authentification', async () => {
    const auth = authentification()
    expect(await appelantAutorise(null, CLE_SERVICE, auth)).toBe(false)
    expect(auth).not.toHaveBeenCalled()
  })

  it('refuse un en-tête qui ne porte pas de jeton porteur', async () => {
    const auth = authentification()
    for (const entete of ['', 'Bearer', 'Bearer ', `Basic ${SESSION}`, SESSION]) {
      expect(await appelantAutorise(entete, CLE_SERVICE, auth), `accepté : « ${entete} »`).toBe(false)
    }
    expect(auth).not.toHaveBeenCalled()
  })

  it('refuse la clé PUBLIQUE de l’application : un jeton signé n’est pas une session', async () => {
    const auth = authentification()
    expect(await appelantAutorise(`Bearer ${CLE_PUBLIQUE}`, CLE_SERVICE, auth)).toBe(false)
    // Et la question a bien été posée au service d'authentification : c'est LUI qui dit non.
    expect(auth).toHaveBeenCalledWith(CLE_PUBLIQUE)
  })

  it('accepte une session que le service d’authentification reconnaît — le garde symétrique', async () => {
    // Sans lui, « on refuse l'inconnu » serait satisfait par un contrôle qui refuse tout le monde, et
    // chaque dépôt perdrait sa lecture.
    expect(await appelantAutorise(`Bearer ${SESSION}`, CLE_SERVICE, authentification())).toBe(true)
  })

  it('accepte la clé de service (receive-email) sans interroger le service d’authentification', async () => {
    // La clé de service n'a pas de session : le service d'authentification la refuserait.
    const auth = authentification()
    expect(await appelantAutorise(`Bearer ${CLE_SERVICE}`, CLE_SERVICE, auth)).toBe(true)
    expect(auth).not.toHaveBeenCalled()
  })

  it('lit le schéma sans tenir compte de la casse, et tolère un blanc final', async () => {
    const auth = authentification()
    expect(await appelantAutorise(`bearer ${CLE_SERVICE}`, CLE_SERVICE, auth)).toBe(true)
    expect(await appelantAutorise(`Bearer ${SESSION} `, CLE_SERVICE, auth)).toBe(true)
  })

  it('sans clé de service connue, rien ne passe pour elle', async () => {
    // Une variable absente ne doit pas devenir une clé que tout le monde connaît : « undefined ».
    const auth = authentification()
    expect(await appelantAutorise('Bearer undefined', undefined, auth)).toBe(false)
    expect(await appelantAutorise(`Bearer ${CLE_SERVICE}`, '', auth)).toBe(false)
  })

  it('une vérification de session qui échoue fait échouer l’appel, jamais passer', async () => {
    // Le service d'authentification injoignable : la promesse rejette, le gestionnaire rend 500 par
    // son `catch`. Le sens dangereux serait de conclure « accepté » faute de réponse.
    const enPanne: SessionRattachee = async () => { throw new Error('service d’authentification injoignable') }
    await expect(appelantAutorise(`Bearer ${SESSION}`, CLE_SERVICE, enPanne)).rejects.toThrow('injoignable')
  })
})

/** Le résultat d'un comptage `head: true`, tel que le client Supabase le rend. */
const lu = (count: number): Comptage => ({ count, error: null })
const refuse = (message = 'lecture refusée'): Comptage => ({ count: null, error: { message } })

describe('extract-piece — une session ne suffit pas, il faut un compte RATTACHÉ', () => {
  it('refuse un compte rattaché à rien : c’est ce que donne l’inscription publique', () => {
    expect(estRattache([lu(0), lu(0), lu(0)])).toBe(false)
  })

  it('accepte chacun des trois rattachements, seul — le garde symétrique', () => {
    // Un chef ou un membre d'équipe (cabinet_admins), un client (memberships), un super-admin. Oublier
    // l'un des trois retirerait la lecture automatique à toute une famille d'utilisateurs, et sans ce
    // cas « on refuse l'inconnu » serait satisfait par un contrôle qui refuse tout le monde.
    expect(estRattache([lu(1), lu(0), lu(0)])).toBe(true)
    expect(estRattache([lu(0), lu(1), lu(0)])).toBe(true)
    expect(estRattache([lu(0), lu(0), lu(1)])).toBe(true)
  })

  it('un compte sans nombre annoncé ne vaut pas rattachement', () => {
    expect(estRattache([{ count: null, error: null }, lu(0), lu(0)])).toBe(false)
  })

  it('sans rattachement lu, une lecture en échec LÈVE au lieu de refuser en silence', () => {
    // Refuser ici rendrait 401 — « connectez-vous » à quelqu'un qui l'est, sur une panne de la base.
    expect(() => estRattache([lu(0), refuse('délai dépassé'), lu(0)])).toThrow(/invérifiable.*délai dépassé/)
    expect(() => estRattache([refuse(), refuse(), refuse()])).toThrow(/invérifiable/)
  })

  it('un rattachement lu suffit, même quand une autre lecture a échoué', () => {
    // Un chef ne doit pas perdre sa lecture parce que `super_admins` n'a pas répondu : on SAIT déjà.
    expect(estRattache([lu(1), refuse(), refuse()])).toBe(true)
  })
})

describe('extract-piece — le contrôle est câblé AVANT toute dépense', () => {
  const gestionnaire = SOURCE.slice(SOURCE.indexOf('Deno.serve('))
  // Ce que le gestionnaire passe au contrôle : entre l'appel et le refus en 401.
  const rappel = gestionnaire.slice(gestionnaire.indexOf('appelantAutorise('), gestionnaire.indexOf('if (!autorise)'))

  it('le gestionnaire appelle le contrôle et refuse en 401', () => {
    expect(gestionnaire).toMatch(/const autorise = await appelantAutorise\(/)
    expect(gestionnaire).toMatch(/if \(!autorise\) \{\s*return json\(\{[^}]*\}, 401\)/)
  })

  it('avant de lire le corps, avant Textract, avant le modèle', () => {
    const controle = gestionnaire.indexOf('appelantAutorise(')
    expect(controle).toBeGreaterThan(-1)
    for (const depense of ['req.arrayBuffer()', 'new TextractClient(', 'citerChamps(']) {
      const position = gestionnaire.indexOf(depense)
      expect(position, `${depense} introuvable dans le gestionnaire — garde-fou à remettre à jour`).toBeGreaterThan(-1)
      expect(controle, `${depense} précède le contrôle d’appelant`).toBeLessThan(position)
    }
  })

  it('la session se vérifie auprès du service d’authentification, et la clé de service vient de l’environnement', () => {
    // Pas de lecture des revendications du jeton : elles ne valent que ce que vaut `verify_jwt`, et
    // ce drapeau s'est déjà retourné une fois en silence au déploiement.
    expect(rappel).toMatch(/\.auth\.getUser\(jeton\)/)
    expect(rappel).toMatch(/if \(error \|\| !data\.user\) return false/)
    expect(gestionnaire).toMatch(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/)
  })

  it('le rattachement se lit sur les TROIS tables, à la clé de service, et décide seul de la réponse', () => {
    expect(rappel).toMatch(/const admin = createClient\(url, Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)!\)/)
    for (const table of ['cabinet_admins', 'memberships', 'super_admins']) {
      expect(rappel, `${table} n’est plus lue`).toMatch(new RegExp(
        String.raw`admin\.from\("${table}"\)\.select\("user_id", \{ count: "exact", head: true \}\)\.eq\("user_id", id\)`))
    }
    expect(rappel).toMatch(/const \[chefs, clients, superAdmins\] = await Promise\.all\(\[/)
    expect(rappel).toMatch(/return estRattache\(\[chefs, clients, superAdmins\]\)/)
    // Une seule sortie positive : celle du rattachement. Un `return true` ailleurs dans le rappel
    // ferait passer toute session, et c'est exactement le trou refermé ici.
    expect(rappel.match(/\breturn\b/g)).toHaveLength(2)
  })
})

describe('receive-email — le seul appelant sans session', () => {
  it('appelle avec la clé de service que le contrôle accepte', () => {
    expect(SOURCE_RECEPTION).toMatch(/fetch\(`\$\{supabaseUrl\}\/functions\/v1\/extract-piece`/)
    expect(SOURCE_RECEPTION).toMatch(/Authorization: `Bearer \$\{serviceRoleKey\}`/)
    expect(SOURCE_RECEPTION).toMatch(/const serviceRoleKey = Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/)
  })
})
