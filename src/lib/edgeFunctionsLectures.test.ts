import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// UNE LECTURE DONT L'ÉCHEC RESSEMBLE À UN RÉSULTAT VIDE SE VÉRIFIE COMME UNE ÉCRITURE — ET LE
// BALAYAGE S'ÉTAIT ARRÊTÉ À `src/`.
//
// `lecturesVerifiees.test.ts` garde cette règle depuis le 21/09/2026, et il ne balaie que `src/`.
// Les écritures, elles, avaient déjà été portées ici (`edgeFunctionsEcritures.test.ts`) après le
// constat que « le balayage s'était arrêté à `src/` ». Les LECTURES, non : exactement la même
// moitié de chemin, un jour plus tard, sur l'autre sens de la même règle.
//
// ET LA RAISON QUI REND CE CÔTÉ PLUS COÛTEUX EST LA MÊME QUE POUR LES ÉCRITURES : dans `src/`, la
// question qui décide est *quelque chose recharge-t-il derrière ?*, et la réponse y est presque
// toujours oui. Dans une Edge Function elle est presque toujours non — rien ne recharge, l'appelant
// reçoit le code de retour que la fonction a décidé d'écrire, et une lecture refusée y produit une
// AFFIRMATION que personne ne peut démentir.
//
// MESURÉ LE 22/09/2026 : 28 lectures nues, 8 en faute, et les trois qui coûtent le plus sont toutes
// des bonnes nouvelles fabriquées — le pire sens de cette famille, personne n'allant vérifier une
// bonne nouvelle.
//
//  • `agent-comptable` — LES TROIS LECTURES DU PLAFOND DE COÛT IA. Chacune échouait du côté
//    OUVERT : sans réponse, les deux seuils sont nuls (« pas de plafond »), la liste des dossiers
//    est vide (« 0,00 $ »), l'usage du mois vaut zéro. N'importe laquelle LEVAIT donc le plafond en
//    silence, sur le seul mécanisme qui borne une dépense. CLAUDE.md désignait déjà
//    `agent_conversations` comme la table dont la troncature « ne vide pas le compteur, elle le
//    SOUS-ESTIME, ce qui est la façon exacte dont un plafond cesse de protéger » — une lecture
//    refusée, elle, le met à zéro.
//  • `superpdp-sync` — la liste des factures DÉJÀ importées. Vide, elle fait réimporter toute la
//    page en un clic : jusqu'à MAX_FACTURES_PAR_SYNC pièces en double venues d'une plateforme
//    agréée DGFiP, donc autant de charges comptées deux fois, sous une réponse « N importées » qui
//    est vraie.
//  • `receive-email` — la détection de doublon, TROISIÈME copie de `fichierDejaPresent`, dont
//    CLAUDE.md dit qu'elle lève précisément parce qu'« un `count` nul est indiscernable d'un aucun
//    doublon trouvé ». Le commentaire au-dessus promettait « la même détection que les autres
//    points d'entrée ».
//  • `send-email` — les lignes d'une facture, six lignes sous une lecture qui, elle, lit son
//    erreur. Un e-mail au bon en-tête et au bon total, SANS AUCUNE LIGNE, parti chez le client.
//
// CE QU'IL GARDE : qu'aucune lecture ne reparte sans que son `{ error }` soit lu. Ce qu'il ne garde
// PAS, annoncé plutôt que laissé deviner : ce qu'on FAIT de l'erreur — refuser, journaliser ou
// remonter est un arbitrage par site. Et, comme son jumeau de `src/`, il ne peut rien contre un
// refus RLS, qui rend zéro ligne SANS erreur.

/**
 * Les fonctions dont des lectures ont le droit de jeter leur erreur, avec la raison ET LE NOMBRE.
 *
 * Le critère est celui de `lecturesVerifiees.test.ts` : **l'échec tombe-t-il du côté FERMÉ ?** Ne
 * rien savoir qui revient à ne rien accorder est légitime ; ne rien savoir qui produit une
 * AFFIRMATION ne l'est pas.
 *
 * LE NOMBRE FAIT PARTIE DE L'EXCEPTION, et c'est le point de conception : dispenser une FONCTION
 * dispense tout son fichier. Or `send-email`, `superpdp-sync`, `superpdp-credentials` et
 * `agent-comptable` portaient chacune, le même jour, une lecture LÉGITIME et une lecture EN FAUTE —
 * une dispense par nom de fichier les aurait couvertes toutes les deux. Une de plus est une
 * rechute, une de moins est une raison morte.
 */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'agent-comptable': {
    nombre: 1,
    raison:
      'le contrôle d’accès `admin_du_dossier`. Sans réponse, `aAcces` est nul et la fonction répond ' +
      '404 : ne rien savoir revient à ne rien accorder, donc lire l’erreur ne changerait ni la ' +
      'décision ni ce que l’appelant voit',
  },
  'create-cabinet': {
    nombre: 1,
    raison:
      'la vérification super-admin. Sans réponse, `superAdminRow` est nul et la création est ' +
      'refusée — le côté FERMÉ, et le seul qui soit sûr sur une fonction qui crée un cabinet',
  },
  'create-client-access': {
    nombre: 4,
    raison:
      'trois lectures d’`appartientDejaAuCabinet` plus le contrôle d’accès. Toutes retombent sur ' +
      '« ce compte n’appartient pas à ce cabinet » ou « pas d’accès », donc sur un REFUS — et le ' +
      'commentaire de cette fonction dit pourquoi ce sens-là est le bon : c’est la garde contre la ' +
      'prise de contrôle d’un compte déjà inscrit ailleurs sur la plateforme',
  },
  'create-team-member': {
    nombre: 5,
    raison:
      'les mêmes lectures d’appartenance et les deux vérifications de rôle (chef de cabinet, ' +
      'super-admin). Sans réponse, le membre n’est pas créé : ne rien savoir ne donne aucun droit',
  },
  'delete-cabinet': {
    nombre: 1,
    raison:
      'la vérification super-admin, sur la fonction la plus destructrice du projet. Sans réponse, ' +
      'la suppression est refusée',
  },
  'send-email': {
    nombre: 2,
    raison:
      'le contrôle d’accès et le nom du dossier, qui répondent tous deux « Dossier introuvable. » ' +
      'en 404 : l’e-mail n’est pas envoyé. La lecture des LIGNES de facture, elle, n’est pas ' +
      'dispensée — elle produisait une facture sans détail, et c’est le défaut corrigé le 22/09/2026',
  },
  'superpdp-credentials': {
    nombre: 1,
    raison:
      'le contrôle d’accès `admin_du_dossier`, qui répond 404. La lecture du STATUT n’est pas ' +
      'dispensée : `configured: false` est une affirmation, et l’écran en tire une invitation à ' +
      'ressaisir un `client_secret` par-dessus celui qui existe',
  },
  'superpdp-emit': {
    nombre: 2,
    raison:
      'le contrôle d’accès et les identifiants Super PDP. Sans identifiants lisibles la fonction ' +
      'refuse d’émettre (400) — le côté FERMÉ sur une transmission à une plateforme agréée DGFiP, ' +
      'qu’un avoir seul peut corriger une fois partie',
  },
  'superpdp-sync': {
    nombre: 2,
    raison:
      'les deux mêmes que pour l’émission — accès et identifiants, tous deux en refus. La liste des ' +
      'factures DÉJÀ importées n’est pas dispensée : vide, elle faisait réimporter toute la page',
  },
}

function fonctions(): string[] {
  const racine = new URL('../../supabase/functions/', import.meta.url)
  return readdirSync(racine, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

function sourceDe(fonction: string): string {
  return readFileSync(new URL(`../../supabase/functions/${fonction}/index.ts`, import.meta.url), 'utf8')
}

/** Voir `retraitsStockage.test.ts` : ce dépôt CITE ses défauts dans ses commentaires. */
function sansCommentairesPleins(texte: string): string {
  return texte
    .split('\n')
    .map((l) => (l.trimStart().startsWith('//') || l.trimStart().startsWith('*') ? '' : l))
    .join('\n')
}

export interface LectureNue {
  ligne: number
  champs: string | null
  forme: 'await' | 'promise-all'
}

const ligneDe = (code: string, index: number) => code.slice(0, index).split('\n').length

/**
 * Le groupe `{ … }` qui commence à `depart`, accolades APPARIÉES — ou null si elles ne le sont pas.
 *
 * Une classe `[^}]*` couperait au premier `}` venu, donc au milieu d'une destructuration imbriquée,
 * et un `error` placé après passerait pour absent. Sixième portée d'expression régulière que ce
 * dépôt aurait payée ; celle-ci est écrite appariée dès le départ.
 */
function groupeAccolades(code: string, depart: number): string | null {
  let profondeur = 0
  for (let i = depart; i < code.length; i++) {
    if (code[i] === '{') profondeur++
    else if (code[i] === '}') { profondeur--; if (profondeur === 0) return code.slice(depart + 1, i) }
  }
  return null
}

/** Qui prend `data` (ou `count`) doit prendre `error`. Sans eux, ce n'est pas un résultat de requête. */
function champsEnFaute(champs: string): boolean {
  return /\b(data|count)\b/.test(champs) && !/\berror\b/.test(champs)
}

/**
 * Les quatre portes de lecture, et le CLIENT n'est pas nommé.
 *
 * Ces fonctions appellent leur client `admin`, `supabase` ou `supabaseAsCaller` selon qu'elles
 * portent la clé de service ou le JWT de l'appelant. Ancrer sur un nom précis, c'est rater la
 * prochaine qui en choisira un autre — la panne de la liste d'inclusion, encore.
 */
const PORTES = String.raw`[A-Za-z_$][\w$]*\s*\.\s*(?:(?:from|rpc)\s*\(|(?:auth|storage)\b)`

/** PORTE 1 — `const { data } = await <client>.<porte>` : on REMONTE les accolades, on ne lit pas la ligne. */
function lecturesAwait(code: string): LectureNue[] {
  const nues: LectureNue[] = []
  const motif = new RegExp(String.raw`await\s+${PORTES}`, 'g')
  let trouve: RegExpExecArray | null
  while ((trouve = motif.exec(code)) !== null) {
    let i = trouve.index - 1
    while (i >= 0 && /\s/.test(code[i])) i--
    if (i < 0 || code[i] !== '=') continue
    i--
    while (i >= 0 && /\s/.test(code[i])) i--
    // Résultat gardé ENTIER : l'erreur reste accessible (voir `fichierDejaPresent`).
    if (i < 0 || code[i] !== '}') continue

    const fermante = i
    let profondeur = 0
    for (; i >= 0; i--) {
      if (code[i] === '}') profondeur++
      else if (code[i] === '{') { profondeur--; if (profondeur === 0) break }
    }
    const ligne = ligneDe(code, trouve.index)
    if (i < 0) { nues.push({ ligne, champs: null, forme: 'await' }); continue }

    const champs = code.slice(i + 1, fermante)
    if (!/\b(const|let|var)\s*$/.test(code.slice(Math.max(0, i - 12), i))) continue
    if (/\berror\b/.test(champs)) continue
    // La SESSION n'est pas une donnée métier, et l'exemption reste NOMMÉE : `auth.admin.*` écrit des
    // comptes, et c'est là qu'un mot de passe jamais posé s'est caché derrière un « ok » dans DEUX
    // de ces fonctions le 21/09/2026 (voir edgeFunctionsEcritures).
    const suite = code.slice(trouve.index + trouve[0].length - 30, trouve.index + trouve[0].length + 30)
    if (/\bauth\s*\.\s*(getUser|getSession)\s*\(/.test(suite)) continue

    nues.push({ ligne, champs: champs.replace(/\s+/g, ' ').trim(), forme: 'await' })
  }
  return nues
}

/**
 * PORTE 2 — `const [ …, { count } ] = await Promise.all([…])`
 *
 * La porte par laquelle la détection de doublon de `receive-email` a vécu : ses deux `count` étaient
 * destructurés au site du `Promise.all`, donc sans un seul `await` devant la requête. On ne cherche
 * pas à relier le rang N du motif au rang N du tableau — c'est la DESTRUCTURATION qui décide.
 */
function lecturesPromiseAll(code: string): LectureNue[] {
  const nues: LectureNue[] = []
  const motif = /=\s*await\s+Promise\.all\s*\(/g
  let trouve: RegExpExecArray | null
  while ((trouve = motif.exec(code)) !== null) {
    let i = trouve.index - 1
    while (i >= 0 && /\s/.test(code[i])) i--
    if (i < 0 || code[i] !== ']') continue
    const fermante = i
    let profondeur = 0
    for (; i >= 0; i--) {
      if (code[i] === ']') profondeur++
      else if (code[i] === '[') { profondeur--; if (profondeur === 0) break }
    }
    if (i < 0) { nues.push({ ligne: ligneDe(code, trouve.index), champs: null, forme: 'promise-all' }); continue }

    const patron = code.slice(i, fermante)
    const motifElement = /\{/g
    let element: RegExpExecArray | null
    while ((element = motifElement.exec(patron)) !== null) {
      const champs = groupeAccolades(patron, element.index)
      if (champs === null) { nues.push({ ligne: ligneDe(code, i + element.index), champs: null, forme: 'promise-all' }); break }
      motifElement.lastIndex = element.index + champs.length + 2
      if (!champsEnFaute(champs)) continue
      nues.push({ ligne: ligneDe(code, i + element.index), champs: champs.replace(/\s+/g, ' ').trim(), forme: 'promise-all' })
    }
  }
  return nues
}

/** Les lectures qui jettent leur erreur, les deux portes confondues. */
export function lecturesSansErreur(source: string): LectureNue[] {
  const code = sansCommentairesPleins(source)
  return [...lecturesAwait(code), ...lecturesPromiseAll(code)].sort((a, b) => a.ligne - b.ligne)
}

// ── Sources SYNTHÉTIQUES : les défauts PLANTÉS, et les voisins qu'il ne doit PAS attraper.
// Sans elles, « le scanner rend zéro » et « le scanner est aveugle » seraient indiscernables.

// Les trois défauts réels du 22/09/2026, dans leur forme d'origine : le plafond par `await`, le
// dédoublonnage par `Promise.all`, la liste des factures déjà importées.
const SOURCE_FAUTIVE = `
async function verifier(admin, dossierId) {
  const { data: cabinet } = await admin.from("cabinets").select("limite_ia_blocage_usd").single()
  const [{ count: dansPieces }, { count: dansDocuments }] = await Promise.all([
    supabase.from("pieces").select("id", { count: "exact", head: true }).eq("storage_hash", hash),
    supabase.from("documents_divers").select("id", { count: "exact", head: true }).eq("storage_hash", hash),
  ])
  const { data: dejaImportees, error } = await admin
    .from("pieces")
    .select("superpdp_invoice_id")
    .eq("dossier_id", dossierId)
  return { cabinet, dansPieces, dansDocuments, dejaImportees, error }
}
`

// Les formes correctes, qui doivent TOUTES passer : l'erreur lue, le résultat gardé entier (ce que
// fait `fichierDejaPresent` avant son `pieces.error ?? documents.error`), la session, et une
// écriture — qui est gardée par `edgeFunctionsEcritures`, pas ici.
const SOURCE_SAINE = `
async function charger(admin) {
  const { data: creds, error: credsError } = await admin.from("superpdp_credentials").select("*").maybeSingle()
  const [pieces, documents, { data: { total }, error: totalError }] = await Promise.all([
    admin.from("pieces").select("id", { count: "exact", head: true }),
    admin.from("documents_divers").select("id", { count: "exact", head: true }),
    admin.rpc("total_dossier", { p_dossier_id: id }),
  ])
  const erreur = pieces.error ?? documents.error
  const { data: callerData } = await supabaseAsCaller.auth.getUser()
  const { data: { user }, error: userError } = await admin.auth.admin.getUserById(id)
  const { error: insertError } = await admin.from("emails_envoyes").insert({})
  return { creds, credsError, erreur, total, totalError, callerData, user, userError, insertError }
}
`

// Le client n'est PAS nommé : ces fonctions l'appellent `admin`, `supabase` ou `supabaseAsCaller`.
// Sans ce cas, ancrer le scanner sur un seul nom resterait entièrement vert.
// `auth.getUser` / `auth.getSession` sont exemptés ; `auth.admin.*` ne doit PAS l'être — c'est la
// porte par laquelle un mot de passe jamais posé s'est caché derrière un « ok » dans DEUX de ces
// fonctions le 21/09/2026. Sans ce cas, élargir l'exemption à `.auth.` resterait entièrement vert.
const SOURCE_AUTH_ADMIN = `
async function creer(admin) {
  const { data } = await admin.auth.admin.listUsers()
  return data
}
`

const SOURCE_AUTRE_CLIENT = `
async function charger() {
  const { data: aAcces } = await supabaseAsCaller.rpc("admin_du_dossier", { p_dossier_id: id })
  return aAcces
}
`

describe('les lectures des Edge Functions lisent leur erreur', () => {
  const toutes = fonctions()

  function fautesRestantes(): string[] {
    const restantes: string[] = []
    for (const f of toutes) {
      const trouvees = lecturesSansErreur(sourceDe(f))
      const exception = EXCEPTIONS[f]
      if (exception && trouvees.length === exception.nombre) continue
      const surplus = exception ? ` (exception déclarée pour ${exception.nombre}, trouvé ${trouvees.length})` : ''
      for (const l of trouvees) {
        restantes.push(`${f}:${l.ligne} [${l.forme}] ${l.champs ?? 'forme non reconnue par ce scanner'}${surplus}`)
      }
    }
    return restantes
  }

  it('parcourt bien toutes les fonctions déployables', () => {
    // Sans cette borne, un scanner qui ne lirait plus rien annoncerait « zéro faute » — la panne qui
    // ressemble exactement au succès, et que ce dépôt a déjà payée plusieurs fois.
    expect(toutes.length).toBeGreaterThanOrEqual(12)
    expect(toutes).toContain('agent-comptable')
    expect(toutes).toContain('receive-email')
    expect(toutes).toContain('superpdp-sync')
  })

  it('voit bien les DEUX portes quelque part — sinon il n’en garderait qu’une', () => {
    // Une borne par porte, séparément : une borne globale laisserait le `await` couvrir l'extinction
    // silencieuse du `Promise.all`, qui est exactement la porte par laquelle le dédoublonnage de
    // `receive-email` a vécu.
    const compte = (motif: RegExp) =>
      toutes.reduce((n, f) => n + (sansCommentairesPleins(sourceDe(f)).match(motif)?.length ?? 0), 0)
    expect(compte(new RegExp(String.raw`await\s+${PORTES}`, 'g'))).toBeGreaterThan(40)
    expect(compte(/await\s+Promise\.all\s*\(/g)).toBeGreaterThan(1)
  })

  it('attrape les trois défauts du 22/09/2026 dans leur forme d’origine', () => {
    const trouvees = lecturesSansErreur(SOURCE_FAUTIVE)
    expect(trouvees.map((l) => l.forme)).toEqual(['await', 'promise-all', 'promise-all'])
    expect(trouvees[0].champs).toBe('data: cabinet')
    expect(trouvees[1].champs).toBe('count: dansPieces')
  })

  it('ne crie au loup ni sur une erreur lue, ni sur un résultat gardé entier, ni sur la session', () => {
    // La troisième entrée du `Promise.all` de cette source porte une destructuration IMBRIQUÉE dont
    // l'`error` vient APRÈS l'accolade interne — la forme exacte qu'une classe `[^}]*` couperait
    // trop tôt, donc une faute inventée sur du code correct. Elle est ici et pas ailleurs parce que
    // `groupeAccolades` ne sert QU'À cette porte : ma première version du cas l'avait mise sur la
    // porte `await`, qui apparie ses accolades elle-même — et la mutation correspondante a SURVÉCU.
    expect(lecturesSansErreur(SOURCE_SAINE)).toEqual([])
  })

  it('n’exempte que la lecture de SESSION, jamais l’administration des comptes', () => {
    expect(lecturesSansErreur(SOURCE_AUTH_ADMIN)).toHaveLength(1)
  })

  it('n’est ancré sur AUCUN nom de client', () => {
    expect(lecturesSansErreur(SOURCE_AUTRE_CLIENT)).toHaveLength(1)
  })

  it('chaque exception porte sa raison ET son compte', () => {
    for (const [fonction, { nombre, raison }] of Object.entries(EXCEPTIONS)) {
      expect(raison.length, `${fonction} : une exception sans raison est une dette muette`).toBeGreaterThan(80)
      expect(nombre, `${fonction} : une exception sans compte dispense toute la fonction`).toBeGreaterThan(0)
    }
  })

  it('n’a aucune exception morte, ni plus large que ce qu’elle couvre', () => {
    const connues = new Set(toutes)
    for (const fonction of Object.keys(EXCEPTIONS)) {
      expect(connues.has(fonction), `exception sur une fonction introuvable : ${fonction}`).toBe(true)
    }
    for (const f of toutes) {
      const exception = EXCEPTIONS[f]
      if (!exception) continue
      expect(
        lecturesSansErreur(sourceDe(f)).length,
        `${f} : l’exception annonce ${exception.nombre} lecture(s) dispensée(s)`,
      ).toBe(exception.nombre)
    }
  })

  it('AUCUNE lecture d’Edge Function ne jette son erreur', () => {
    expect(
      fautesRestantes(),
      'dans une Edge Function rien ne recharge derrière : une lecture refusée produit une affirmation ' +
      'que personne ne peut démentir',
    ).toEqual([])
  })
})
