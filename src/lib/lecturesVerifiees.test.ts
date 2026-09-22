import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// UNE LECTURE DONT L'ÉCHEC RESSEMBLE À UN RÉSULTAT VIDE SE VÉRIFIE COMME UNE ÉCRITURE.
//
// La règle est dans CLAUDE.md depuis longtemps, et elle a été VÉRIFIÉE À LA MAIN deux fois le
// 21/09/2026. La première passe a classé onze lectures « légitimes » en n'en nommant que trois —
// les huit autres n'avaient pas été ouvertes, seulement comptées. La seconde, faite en les lisant
// une par une, a trouvé QUATRE défauts dedans, dont trois du même motif : une lecture qui échoue
// laisse un formulaire à ses valeurs par défaut, et l'enregistrement qui suit porte TOUS les
// champs — donc écrase ce qu'on n'a pas su lire.
//
// C'est exactement ce que ce dépôt appelle « une vérification qu'il faut penser à rejouer, et dont
// personne ne peut voir qu'elle est fausse ». Elle devient donc un test, comme `verrousExecution`,
// `lecturesPaginees`, `retraitsStockage`, `erreursSupabase` et `recherchesEtTotaux` avant elle.
//
// CE QU'IL NE PEUT PAS GARDER, annoncé plutôt que laissé deviner : **un refus RLS ne produit
// AUCUNE erreur** — mesuré par impersonation d'un compte rattaché à rien, il rend zéro ligne et
// c'est tout. Lire `error` attrape une session expirée, une coupure réseau, un 5xx, une colonne
// renommée ; pas une policy qui se referme. La moitié gouvernable est gardée ici, l'autre reste
// une question de conception d'écran.
//
// ── ET IL NE VOYAIT QU'UNE LECTURE SUR DEUX FORMES (22/09/2026) ────────────────────────────────
//
// Sa première version partait de `await supabase`. Or **une lecture s'écrit aussi sans `await`** :
// comme entrée d'un `Promise.all([...])`, qui est le chargement normal d'un écran de ce dépôt, et
// comme chaîne `.then(({ data }) => …)` dans un `useEffect`. Le scanner ne pouvait rien en dire, et
// son silence était indiscernable d'un dépôt sain — la panne que ce dépôt connaît sous cinq autres
// noms.
//
// Mesuré : 14 lectures nues, dont **huit en faute**, toutes de la famille qu'il existe pour garder.
// Les trois qui coûtaient le plus : `FinancementTab` était la QUATRIÈME copie de « lecture →
// formulaire → upsert de tous les champs » — les trois premières ayant été corrigées la veille par
// ce scanner même, par la porte qu'il regardait ; `ClotureTab` produisait une 2035 SIGNÉE sans nom
// ni SIRET de déclarant ; `FactureApercu` imprimait une facture sans lignes sous des totaux bien
// présents.
//
// LA RÈGLE QUI DÉCIDE EST LA MÊME POUR LES TROIS FORMES, et elle se dit en une phrase : **qui prend
// `data` prend `error`**. Un résultat gardé ENTIER (`const r = …`, puis `r.error`) reste légitime —
// l'erreur y est accessible, et c'est ce que fait `fichierDejaPresent`.
//
// ET IL RESTE UNE QUATRIÈME FORME QU'IL NE VOIT PAS, dite plutôt que laissée croire : une requête
// CONSTRUITE d'un côté et attendue de l'autre (`const requete = requeteDeBase(table)` …
// `await requete.range(…)`, dans `sauvegardeDonnees.ts`). L'ancre `supabase` n'est alors plus sur le
// site qui attend. Elle n'existe qu'une fois dans le dépôt et son site d'attente lit bien son erreur
// — vérifié en l'ouvrant, pas en la comptant. Ce qui la rendrait dangereuse serait qu'elle se
// répande : c'est le couple habituel de ce dépôt, une moitié gardée par le code, l'autre annoncée.
//
// Je l'avais d'abord inscrite en EXCEPTION, avec un compte de 1 : le garde des exceptions mortes
// l'a refusée, puisque le scanner ne la voit pas du tout — donc rien n'y est dispensé. Une exception
// pour une faute qui n'existe pas est une raison morte, et c'est exactement ce que ce compte attrape.

/**
 * Les fichiers dont les lectures ont le droit de jeter leur erreur, avec la raison ET LE NOMBRE.
 *
 * Le critère est toujours le même : l'échec tombe-t-il du côté FERMÉ ? Si ne rien savoir revient à
 * ne rien accorder, l'erreur n'apprend rien de plus. Si ne rien savoir produit une AFFIRMATION —
 * « aucun accès », « aucun événement », un formulaire vide qu'on va réenregistrer — alors non.
 *
 * L'EXCEPTION PORTE UN NOMBRE, ET C'EST LE POINT DE CONCEPTION (leçon de `datesUtc.test.ts`,
 * reprise ici le 22/09/2026) : dispenser un FICHIER dispense tout le fichier. Or les trois fichiers
 * dispensés ci-dessous portent AUSSI des lectures correctes, et deux d'entre eux ont gagné une
 * lecture en faute le jour même — une rechute y serait passée sans un mot. Le compte doit tomber
 * juste : une de plus est une rechute, une de moins est une raison morte.
 */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'context/AuthContext.tsx': {
    nombre: 4,
    raison:
      'les quatre lectures de rôle échouent du côté FERMÉ : sans réponse, personne n’est super-admin ' +
      'ni chef de cabinet, et aucun dossier n’est visible. Lire l’erreur ne changerait rien à ce qui ' +
      'est affiché, et un contexte de session ne peut pas refuser de se monter',
  },
  'lib/texteOcr.ts': {
    nombre: 1,
    raison:
      'c’est le chemin d’AFFICHAGE du texte lu. Son jumeau destructeur `lireTexteOcrDuDocument` — ' +
      'celui dont dépend la suppression d’un document — rend bien son erreur, et c’est lui qui compte',
  },
  'lib/branding.ts': {
    nombre: 1,
    raison:
      'la charte du cabinet. Sans réponse, l’application applique la charte PAR DÉFAUT, qui est ' +
      'exactement ce qu’obtient un cabinet qui n’en a pas défini : aucune donnée métier n’est ' +
      'affirmée, et l’écran qui ÉCRIT cette charte (CabinetBrandingPage) lit bien son erreur depuis ' +
      'le 21/09/2026 — c’est lui qui pouvait l’effacer',
  },
  'pages/DossierDetail.tsx': {
    nombre: 1,
    raison:
      'l’en-tête du dossier. Sans réponse, `dossier` reste nul et l’écran garde ses SQUELETTES : il ' +
      'n’affirme rien, il ne finit pas de charger — ce qui se voit. Le sélecteur d’exercice et la ' +
      'bascule TVA, qui eux écriraient, ne sont pas rendus tant qu’il est nul',
  },
  'pages/ClientHome.tsx': {
    nombre: 1,
    raison:
      'le dossier ne sert ici qu’à la ligne d’accueil (« Ton espace pour X »). Les quatre tuiles ' +
      'chiffrées et « ce qu’il reste à envoyer » viennent de `lireTout` et de `lireAnneesCloturees`, ' +
      'qui rendent tous deux leur état — et « aucun dossier rattaché » se décide sur `dossierId`, ' +
      'jamais sur cette lecture',
  },
}

export function sources(): { chemin: string; texte: string }[] {
  const racine = new URL('../', import.meta.url)
  const trouves: { chemin: string; texte: string }[] = []
  const parcourir = (dossier: URL, prefixe: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name === 'test') continue
      const suivant = new URL(`${entree.name}${entree.isDirectory() ? '/' : ''}`, dossier)
      if (entree.isDirectory()) { parcourir(suivant, `${prefixe}${entree.name}/`); continue }
      if (!/\.tsx?$/.test(entree.name) || /\.test\.tsx?$/.test(entree.name)) continue
      trouves.push({ chemin: `${prefixe}${entree.name}`, texte: readFileSync(suivant, 'utf8') })
    }
  }
  parcourir(racine, '')
  return trouves
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
  /** Les champs destructurés, ou null quand la forme échappe au scanner — ce qui est une FAUTE. */
  champs: string | null
  /** Par quelle porte elle est entrée : utile au message, et c'est la porte qui a manqué en premier. */
  forme: 'await' | 'then' | 'promise-all'
}

const ligneDe = (code: string, index: number) => code.slice(0, index).split('\n').length

/**
 * Le groupe `{ … }` qui COMMENCE à `depart`, accolades appariées — ou null si elles ne le sont pas.
 *
 * Une classe `[^}]*` couperait au premier `}` venu, donc au milieu d'une destructuration imbriquée
 * (`{ data: { user } }`) : elle rendrait des champs tronqués, et un `error` placé après passerait
 * pour absent. C'est la même famille que les cinq portées d'expression régulière déjà payées ici.
 */
function groupeAccolades(code: string, depart: number): string | null {
  let profondeur = 0
  for (let i = depart; i < code.length; i++) {
    if (code[i] === '{') profondeur++
    else if (code[i] === '}') { profondeur--; if (profondeur === 0) return code.slice(depart + 1, i) }
  }
  return null
}

/** Qui prend `data` doit prendre `error`. Un motif sans `data` ne lit pas un résultat de requête. */
function champsEnFaute(champs: string): boolean {
  return /\bdata\b/.test(champs) && !/\berror\b/.test(champs)
}

/**
 * La SESSION, qui n'est pas une donnée métier — et l'exemption est NOMMÉE, jamais `.auth.` en entier.
 *
 * `getUser` et `getSession` échouent du côté FERMÉ : sans réponse on n'est pas connecté, ce que ce
 * dépôt traite partout par `?? null`. `auth.admin.*`, lui, ÉCRIT des comptes, et c'est exactement là
 * qu'un mot de passe jamais posé s'est caché derrière un « ok » dans deux Edge Functions le
 * 21/09/2026 — élargir l'exemption à `.auth.` le rouvrirait, sur les trois portes à la fois.
 *
 * Elle vaut pour les DEUX portes qui la rencontrent : la porte 1 la connaissait, la porte 2 non — et
 * c'est elle qui a trouvé le `supabase.auth.getSession().then(…)` d'AuthContext le 22/09/2026.
 */
function lectureDeSession(suite: string): boolean {
  return /^\s*\.\s*auth\s*\.\s*(getUser|getSession)\s*\(/.test(suite)
}

/**
 * PORTE 1 — `const { data } = await supabase…`
 *
 * Le balayage part de `await supabase` et REMONTE les accolades, plutôt que de partir d'une forme de
 * destructuration : c'est ce qui rend impossible d'en sauter une. Une destructuration que le
 * scanner ne sait pas lire est signalée comme faute et non ignorée — « zéro faute » et « aveugle »
 * doivent rester distinguables (leçon payée trois fois sur `lecturesPaginees`).
 */
function lecturesAwait(code: string): LectureNue[] {
  const nues: LectureNue[] = []
  const motif = /await\s+supabase\b/g
  let trouve: RegExpExecArray | null
  while ((trouve = motif.exec(code)) !== null) {
    const ligne = ligneDe(code, trouve.index)

    // ON REMONTE LES ACCOLADES, ON NE LIT PAS « LA LIGNE ». La première version de ce scanner
    // lisait le texte depuis le début de la ligne portant `await supabase` — et RATAIT entièrement
    // une destructuration coupée sur plusieurs lignes, qui est le formatage normal de ce dépôt.
    // Trouvé par son propre cas synthétique, pas par relecture : c'est la troisième fois qu'un
    // scanner de ce projet se fait prendre par le retour à la ligne.
    let i = trouve.index - 1
    while (i >= 0 && /\s/.test(code[i])) i--
    if (i < 0 || code[i] !== '=') continue
    i--
    while (i >= 0 && /\s/.test(code[i])) i--
    // Pas de destructuration : le résultat entier est gardé, donc l'erreur reste accessible.
    if (i < 0 || code[i] !== '}') continue

    const fermante = i
    let profondeur = 0
    for (; i >= 0; i--) {
      if (code[i] === '}') profondeur++
      else if (code[i] === '{') { profondeur--; if (profondeur === 0) break }
    }
    // Défensif : des accolades non appariées veulent dire que ce scanner ne sait pas lire cette
    // forme, et « je ne sais pas lire » doit échouer, jamais passer en silence.
    if (i < 0) { nues.push({ ligne, champs: null, forme: 'await' }); continue }

    const champs = code.slice(i + 1, fermante)
    if (!/\b(const|let|var)\s*$/.test(code.slice(Math.max(0, i - 12), i))) continue
    if (/\berror\b/.test(champs)) continue
    // `auth.getUser()` ne lit pas des DONNÉES mais la session, et son absence se dit déjà par
    // `user?.id ?? null` — que ce dépôt traite partout. Écarté NOMMÉMENT et pas par `.auth.` en
    // entier : `auth.admin.*` écrit des comptes, et c'est là qu'un mot de passe jamais posé s'est
    // caché derrière un « ok » (voir edgeFunctionsEcritures).
    const suite = code.slice(trouve.index + trouve[0].length, trouve.index + trouve[0].length + 40)
    if (lectureDeSession(suite)) continue

    nues.push({ ligne, champs: champs.replace(/\s+/g, ' ').trim(), forme: 'await' })
  }
  return nues
}

/**
 * PORTE 2 — `supabase…then(({ data }) => …)`
 *
 * Le corps s'arrête au `supabase` SUIVANT, jamais « à la fin du fichier » : un `.then(` cent lignes
 * plus bas n'appartient pas à cette chaîne-ci, et s'y raccorder rendrait une faute sur une lecture
 * saine. C'est la borne de `lecturesPaginees` (« un corps s'arrête au `.from(` suivant »), appliquée
 * à l'ancre de ce scanner-ci.
 *
 * Un `.then((res) => …)` sans destructuration reste légitime, par la même règle que la porte 1 : le
 * résultat est gardé entier, donc `res.error` est là.
 */
function lecturesThen(code: string): LectureNue[] {
  const nues: LectureNue[] = []
  const ancres = [...code.matchAll(/\bsupabase\b/g)]
  for (const [rang, ancre] of ancres.entries()) {
    const fin = ancres[rang + 1]?.index ?? code.length
    const corps = code.slice(ancre.index, fin)
    if (lectureDeSession(corps.slice('supabase'.length))) continue
    const then = /\.\s*then\s*\(\s*\(?\s*\{/.exec(corps)
    if (!then) continue
    const depart = ancre.index + then.index + then[0].length - 1
    const champs = groupeAccolades(code, depart)
    if (champs === null) { nues.push({ ligne: ligneDe(code, depart), champs: null, forme: 'then' }); continue }
    if (!champsEnFaute(champs)) continue
    nues.push({ ligne: ligneDe(code, depart), champs: champs.replace(/\s+/g, ' ').trim(), forme: 'then' })
  }
  return nues
}

/**
 * PORTE 3 — `const [ …, { data } ] = await Promise.all([…])`
 *
 * C'est le chargement NORMAL d'un écran de ce dépôt, donc la porte la plus fréquentée — et celle
 * qui a laissé passer les huit fautes du 22/09/2026. On ne cherche pas à relier le rang N du motif
 * au rang N du tableau : ce n'est pas nécessaire, puisque c'est la DESTRUCTURATION qui décide. Un
 * élément `{ data: … }` sans `error` jette l'erreur, quelle que soit l'expression dont il vient ;
 * un élément nommé (`lecturePieces`) garde tout, y compris ce que `lireTout` rend de son état.
 */
function lecturesPromiseAll(code: string): LectureNue[] {
  const nues: LectureNue[] = []
  const motif = /=\s*await\s+Promise\.all\s*\(/g
  let trouve: RegExpExecArray | null
  while ((trouve = motif.exec(code)) !== null) {
    let i = trouve.index - 1
    while (i >= 0 && /\s/.test(code[i])) i--
    // Pas de destructuration en tableau : le résultat entier est gardé (voir `fichierDejaPresent`,
    // qui lit ensuite `pieces.error ?? documents.error`).
    if (i < 0 || code[i] !== ']') continue
    const fermante = i
    let profondeur = 0
    for (; i >= 0; i--) {
      if (code[i] === ']') profondeur++
      else if (code[i] === '[') { profondeur--; if (profondeur === 0) break }
    }
    if (i < 0) { nues.push({ ligne: ligneDe(code, trouve.index), champs: null, forme: 'promise-all' }); continue }

    const motifElement = /\{/g
    const patron = code.slice(i, fermante)
    let element: RegExpExecArray | null
    while ((element = motifElement.exec(patron)) !== null) {
      const champs = groupeAccolades(patron, element.index)
      if (champs === null) { nues.push({ ligne: ligneDe(code, i + element.index), champs: null, forme: 'promise-all' }); break }
      // On saute le groupe entier : une imbrication n'est pas un second élément.
      motifElement.lastIndex = element.index + champs.length + 2
      if (!champsEnFaute(champs)) continue
      nues.push({ ligne: ligneDe(code, i + element.index), champs: champs.replace(/\s+/g, ' ').trim(), forme: 'promise-all' })
    }
  }
  return nues
}

/** Les lectures qui jettent leur erreur, TOUTES PORTES CONFONDUES. */
export function lecturesSansErreur(chemin: string, texte: string): LectureNue[] {
  void chemin
  const code = sansCommentairesPleins(texte)
  return [...lecturesAwait(code), ...lecturesThen(code), ...lecturesPromiseAll(code)]
    .sort((a, b) => a.ligne - b.ligne)
}

// ── Sources SYNTHÉTIQUES : le défaut PLANTÉ, et les deux voisins qu'il ne doit PAS attraper.
// Sans elles, « le scanner rend zéro » et « le scanner est aveugle » seraient indiscernables.
const SOURCE_FAUTIVE = `
async function charger() {
  const { data: pieces, error: erreurPieces } = await supabase.from('pieces').select('*')
  const { data: infos } = await supabase
    .from('informations_dossier')
    .select('*')
    .maybeSingle()
  const { data: banque, error } = await supabase.from('lignes_bancaires').select('*')
  return { pieces, infos, banque, erreurPieces, error }
}
`

const SOURCE_SAINE = `
async function ecrire() {
  const { data: userData } = await supabase.auth.getUser()
  const { error } = await supabase.from('pieces').insert({ auteur: userData.user?.id ?? null })
  const resultat = await supabase.from('pieces').select('*')
  return { error, resultat }
}
`

// `auth.getUser()` est écarté ; `auth.admin.*` ne doit PAS l'être — c'est la porte par laquelle un
// mot de passe jamais posé s'est caché derrière un « ok » dans deux Edge Functions le 21/09/2026.
// Sans ce cas, élargir l'exemption à `.auth.` en entier resterait entièrement vert.
const SOURCE_AUTH_ADMIN = `
async function creer() {
  const { data } = await supabase.auth.admin.listUsers()
  return data
}
`

// La même frontière, sur la PORTE 2 : la session passe, l'administration des comptes non. Sans ce
// cas, ramener `lectureDeSession` à `.auth.` en entier resterait vert sur cette porte-là.
const SOURCE_SESSION_THEN = `
function monter() {
  supabase.auth.getSession().then(({ data }) => setSession(data.session))
  supabase.auth.admin.listUsers().then(({ data }) => setComptes(data?.users ?? []))
}
`

const SOURCE_ILLISIBLE = `
async function charger() {
  const {
    data,
  } = await supabase.from('pieces').select('*')
  return data
}
`

// ── PORTE 2 : la chaîne `.then(…)`, qui s'écrit SANS `await`.
// Trois cas dans une seule source, dont deux que le scanner ne doit PAS attraper : le résultat
// gardé entier, et une destructuration IMBRIQUÉE dont l'`error` vient après l'accolade interne —
// celle qu'une classe `[^}]*` couperait, donc une faute inventée sur du code correct.
const SOURCE_THEN = `
function monter() {
  supabase.from('facture_lignes').select('*').eq('facture_id', id).order('ordre')
    .then(({ data }) => setLignes(data ?? []))
  supabase.from('cabinets').select('nom').eq('id', id).maybeSingle()
    .then(({ data, error }) => { if (!error) setNom(data?.nom ?? null) })
  supabase.from('pieces').select('*').then((resultat) => setPieces(resultat.data ?? []))
  supabase.from('dossiers').select('*').maybeSingle()
    .then(({ data: { nom }, error }) => setNom(nom ?? null))
}
`

// ── PORTE 3 : l'entrée de `Promise.all`, le chargement NORMAL d'un écran de ce dépôt.
// Le patron mêle ce que ce dépôt écrit vraiment : des résultats de `lireTout` gardés entiers, une
// lecture nue en faute, et une lecture nue correcte. Sans les deux dernières, « le scanner voit
// quelque chose » et « le scanner crie au loup » seraient indiscernables.
const SOURCE_PROMISE_ALL = `
async function load() {
  const [lecturePieces, { data: previsionnelData }, { data: dossier, error: dossierError }] =
    await Promise.all([
      lireTout((debut, fin) => supabase.from('pieces').select('*', { count: 'exact' }).range(debut, fin)),
      supabase.from('previsionnels_bancaires').select('*').eq('dossier_id', id).maybeSingle(),
      supabase.from('dossiers').select('*').eq('id', id).maybeSingle(),
    ])
  return { lecturePieces, previsionnelData, dossier, dossierError }
}
`

// Le résultat gardé ENTIER dans un Promise.all — `fichierDejaPresent` fait exactement cela, et lit
// ensuite `pieces.error ?? documents.error`. Le signaler serait une faute inventée.
const SOURCE_PROMISE_ALL_ENTIER = `
async function fichierDejaPresent() {
  const [pieces, documents] = await Promise.all([
    supabase.from('pieces').select('id', { count: 'exact', head: true }),
    supabase.from('documents_divers').select('id', { count: 'exact', head: true }),
  ])
  const erreur = pieces.error ?? documents.error
  if (erreur) throw new Error(erreur.message)
  return (pieces.count ?? 0) > 0
}
`

describe('une lecture Supabase lit son erreur', () => {
  const tout = sources()

  /** Les fautes qui restent une fois les exceptions honorées — avec leur COMPTE, pas leur nom seul. */
  function fautesRestantes(): string[] {
    const restantes: string[] = []
    for (const f of tout) {
      const trouvees = lecturesSansErreur(f.chemin, f.texte)
      const exception = EXCEPTIONS[f.chemin]
      if (exception && trouvees.length === exception.nombre) continue
      const surplus = exception ? ` (exception déclarée pour ${exception.nombre}, trouvé ${trouvees.length})` : ''
      for (const l of trouvees) {
        restantes.push(`${f.chemin}:${l.ligne} [${l.forme}] ${l.champs ?? 'forme non reconnue par ce scanner'}${surplus}`)
      }
    }
    return restantes
  }

  it('parcourt bien les sources de production', () => {
    // La borne qui empêche « zéro faute » de vouloir dire « je ne lis plus rien ».
    expect(tout.length).toBeGreaterThan(60)
    expect(tout.map((f) => f.chemin)).toContain('lib/informationsDossier.ts')
    expect(tout.map((f) => f.chemin)).toContain('pages/dossier/AccesTab.tsx')
  })

  it('voit bien les TROIS portes quelque part — sinon il ne garderait qu’une lecture sur deux', () => {
    // La borne de chaque porte, séparément. Une seule borne globale laisserait le `await` couvrir
    // l'extinction silencieuse des deux autres — exactement ce qui a duré jusqu'au 22/09/2026.
    const compte = (motif: RegExp) =>
      tout.reduce((n, f) => n + [...sansCommentairesPleins(f.texte).matchAll(motif)].length, 0)
    expect(compte(/await\s+supabase\b/g)).toBeGreaterThan(50)
    expect(compte(/\.\s*then\s*\(/g)).toBeGreaterThan(3)
    expect(compte(/await\s+Promise\.all\s*\(/g)).toBeGreaterThan(5)
  })

  it('attrape la lecture nue coincée entre deux lectures correctes', () => {
    // Le défaut PLANTÉ, dans la forme exacte qui l'a laissé vivre : une chaîne coupée sur plusieurs
    // lignes, entourée de voisines irréprochables.
    const trouvees = lecturesSansErreur('synthetique/fautive.ts', SOURCE_FAUTIVE)
    expect(trouvees).toHaveLength(1)
    expect(trouvees[0].champs).toContain('data: infos')
    expect(trouvees[0].forme).toBe('await')
  })

  it('ne crie pas au loup sur une session lue ni sur un résultat gardé entier', () => {
    expect(lecturesSansErreur('synthetique/saine.ts', SOURCE_SAINE)).toEqual([])
  })

  it('attrape aussi une destructuration coupée sur PLUSIEURS lignes', () => {
    // La forme qui aveuglait la première version de ce scanner, et que son propre cas synthétique a
    // démasquée : lire « la ligne » de `await supabase` ne voit rien quand le `const {` est trois
    // lignes plus haut. C'est le formatage normal du dépôt, donc l'angle mort le plus probable.
    const trouvees = lecturesSansErreur('synthetique/illisible.ts', SOURCE_ILLISIBLE)
    expect(trouvees).toHaveLength(1)
    expect(trouvees[0].champs).toBe('data,')
  })

  it('n’exempte que la lecture de SESSION, jamais l’administration des comptes', () => {
    expect(lecturesSansErreur('synthetique/admin.ts', SOURCE_AUTH_ADMIN)).toHaveLength(1)
  })

  it('PORTE 2 — attrape un `.then(({ data }) => …)`, qui s’écrit sans `await`', () => {
    const trouvees = lecturesSansErreur('synthetique/then.ts', SOURCE_THEN)
    expect(trouvees.map((l) => l.forme)).toEqual(['then'])
    expect(trouvees[0].champs).toBe('data')
  })

  it('PORTE 2 — ni sur le résultat gardé entier, ni sur une destructuration IMBRIQUÉE', () => {
    // Les deux voisins de la source ci-dessus. Le second est celui qu'une classe `[^}]*` couperait
    // au `}` de `{ nom }`, donc AVANT l'`error` : une faute inventée sur du code correct, et la
    // sixième fois que ce dépôt se ferait prendre par la portée d'une expression régulière.
    const lignes = lecturesSansErreur('synthetique/then.ts', SOURCE_THEN).map((l) => l.ligne)
    expect(lignes).toHaveLength(1)
    expect(SOURCE_THEN.split('\n')[lignes[0] - 1]).toContain('setLignes')
  })

  it('PORTE 2 — la SESSION passe, l’administration des comptes non', () => {
    // C'est ce cas-là que l'extension du 22/09/2026 a trouvé dans AuthContext : un
    // `auth.getSession().then(({ data }) => …)` que la porte 1 ne pouvait pas voir. Il est exempté
    // pour la même raison que `getUser` — sans réponse, on n'est pas connecté — et la seconde ligne
    // garde la borne : `auth.admin.*` écrit des comptes, il n'est jamais exempté.
    const trouvees = lecturesSansErreur('synthetique/session.ts', SOURCE_SESSION_THEN)
    expect(trouvees).toHaveLength(1)
    expect(SOURCE_SESSION_THEN.split('\n')[trouvees[0].ligne - 1]).toContain('admin.listUsers')
  })

  it('PORTE 3 — attrape une entrée de `Promise.all` destructurée sans `error`', () => {
    const trouvees = lecturesSansErreur('synthetique/promiseall.ts', SOURCE_PROMISE_ALL)
    expect(trouvees.map((l) => l.forme)).toEqual(['promise-all'])
    expect(trouvees[0].champs).toBe('data: previsionnelData')
  })

  it('PORTE 3 — ne dit rien d’un résultat gardé entier dans un `Promise.all`', () => {
    // `fichierDejaPresent` : deux résultats nommés, puis `pieces.error ?? documents.error`. C'est la
    // forme correcte de cette porte, et la signaler rendrait le scanner inutilisable.
    expect(lecturesSansErreur('synthetique/entier.ts', SOURCE_PROMISE_ALL_ENTIER)).toEqual([])
  })

  it('chaque exception porte sa raison ET son compte', () => {
    for (const [chemin, { nombre, raison }] of Object.entries(EXCEPTIONS)) {
      expect(raison.length, `${chemin} : une exception sans raison est une dette muette`).toBeGreaterThan(80)
      expect(nombre, `${chemin} : une exception sans compte dispense tout le fichier`).toBeGreaterThan(0)
    }
  })

  it('n’a aucune exception morte', () => {
    // Sans ce garde, la liste se remplirait de fichiers disparus ou devenus corrects, et personne
    // ne saurait plus lesquelles sont encore vraies.
    const connus = new Set(tout.map((f) => f.chemin))
    for (const chemin of Object.keys(EXCEPTIONS)) {
      expect(connus.has(chemin), `exception sur un fichier introuvable : ${chemin}`).toBe(true)
    }
    // Et aucune exception plus LARGE que ce qu'elle couvre : une de moins est une raison morte, une
    // de plus est une rechute. C'est ce que le compte ajoute au nom du fichier.
    for (const f of tout) {
      const exception = EXCEPTIONS[f.chemin]
      if (!exception) continue
      expect(
        lecturesSansErreur(f.chemin, f.texte).length,
        `${f.chemin} : l’exception annonce ${exception.nombre} lecture(s) dispensée(s)`,
      ).toBe(exception.nombre)
    }
  })

  it('AUCUNE lecture de production ne jette son erreur', () => {
    expect(fautesRestantes()).toEqual([])
  })
})
