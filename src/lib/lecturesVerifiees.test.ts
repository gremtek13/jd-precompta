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

/**
 * Les fichiers dont les lectures ont le droit de jeter leur erreur, avec la raison.
 *
 * Le critère est toujours le même : l'échec tombe-t-il du côté FERMÉ ? Si ne rien savoir revient à
 * ne rien accorder, l'erreur n'apprend rien de plus. Si ne rien savoir produit une AFFIRMATION —
 * « aucun accès », « aucun événement », un formulaire vide qu'on va réenregistrer — alors non.
 */
const EXCEPTIONS: Record<string, string> = {
  'context/AuthContext.tsx':
    'les quatre lectures de rôle échouent du côté FERMÉ : sans réponse, personne n’est super-admin ' +
    'ni chef de cabinet, et aucun dossier n’est visible. Lire l’erreur ne changerait rien à ce qui ' +
    'est affiché, et un contexte de session ne peut pas refuser de se monter',
  'lib/texteOcr.ts':
    'c’est le chemin d’AFFICHAGE du texte lu. Son jumeau destructeur `lireTexteOcrDuDocument` — ' +
    'celui dont dépend la suppression d’un document — rend bien son erreur, et c’est lui qui compte',
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
}

/**
 * Les lectures qui jettent leur erreur.
 *
 * Le balayage part de `await supabase` et REMONTE la ligne, plutôt que de partir d'une forme de
 * destructuration : c'est ce qui rend impossible d'en sauter une. Une destructuration que le
 * scanner ne sait pas lire est signalée comme faute et non ignorée — « zéro faute » et « aveugle »
 * doivent rester distinguables (leçon payée trois fois sur `lecturesPaginees`).
 */
export function lecturesSansErreur(chemin: string, texte: string): LectureNue[] {
  if (EXCEPTIONS[chemin]) return []
  const code = sansCommentairesPleins(texte)
  const nues: LectureNue[] = []
  const motif = /await\s+supabase\b/g
  let trouve: RegExpExecArray | null
  while ((trouve = motif.exec(code)) !== null) {
    const ligne = code.slice(0, trouve.index).split('\n').length

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
    if (i < 0) { nues.push({ ligne, champs: null }); continue }

    const champs = code.slice(i + 1, fermante)
    if (!/\b(const|let|var)\s*$/.test(code.slice(Math.max(0, i - 12), i))) continue
    if (/\berror\b/.test(champs)) continue
    // `auth.getUser()` ne lit pas des DONNÉES mais la session, et son absence se dit déjà par
    // `user?.id ?? null` — que ce dépôt traite partout. Écarté NOMMÉMENT et pas par `.auth.` en
    // entier : `auth.admin.*` écrit des comptes, et c'est là qu'un mot de passe jamais posé s'est
    // caché derrière un « ok » (voir edgeFunctionsEcritures).
    const suite = code.slice(trouve.index + trouve[0].length, trouve.index + trouve[0].length + 40)
    if (/^\s*\.\s*auth\s*\.\s*getUser\s*\(/.test(suite)) continue

    nues.push({ ligne, champs: champs.replace(/\s+/g, ' ').trim() })
  }
  return nues
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

const SOURCE_ILLISIBLE = `
async function charger() {
  const {
    data,
  } = await supabase.from('pieces').select('*')
  return data
}
`

describe('une lecture Supabase lit son erreur', () => {
  const tout = sources()

  it('parcourt bien les sources de production', () => {
    // La borne qui empêche « zéro faute » de vouloir dire « je ne lis plus rien ».
    expect(tout.length).toBeGreaterThan(60)
    expect(tout.map((f) => f.chemin)).toContain('lib/informationsDossier.ts')
    expect(tout.map((f) => f.chemin)).toContain('pages/dossier/AccesTab.tsx')
  })

  it('voit bien des lectures quelque part — sinon il ne garderait rien', () => {
    const lectures = tout.reduce(
      (n, f) => n + [...sansCommentairesPleins(f.texte).matchAll(/await\s+supabase\b/g)].length,
      0,
    )
    expect(lectures).toBeGreaterThan(50)
  })

  it('attrape la lecture nue coincée entre deux lectures correctes', () => {
    // Le défaut PLANTÉ, dans la forme exacte qui l'a laissé vivre : une chaîne coupée sur plusieurs
    // lignes, entourée de voisines irréprochables.
    const trouvees = lecturesSansErreur('synthetique/fautive.ts', SOURCE_FAUTIVE)
    expect(trouvees).toHaveLength(1)
    expect(trouvees[0].champs).toContain('data: infos')
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

  it('honore les exceptions déclarées, et seulement elles', () => {
    expect(lecturesSansErreur('context/AuthContext.tsx', SOURCE_FAUTIVE)).toEqual([])
    expect(lecturesSansErreur('lib/informationsDossier.ts', SOURCE_FAUTIVE)).toHaveLength(1)
  })

  it('chaque exception porte sa raison, pas juste un nom de fichier', () => {
    for (const [chemin, raison] of Object.entries(EXCEPTIONS)) {
      expect(raison.length, `${chemin} : une exception sans raison est une dette muette`).toBeGreaterThan(80)
    }
  })

  it('n’a aucune exception morte', () => {
    // Sans ce garde, la liste se remplirait de fichiers disparus ou devenus corrects, et personne
    // ne saurait plus lesquelles sont encore vraies.
    const connus = new Set(tout.map((f) => f.chemin))
    for (const chemin of Object.keys(EXCEPTIONS)) {
      expect(connus.has(chemin), `exception sur un fichier introuvable : ${chemin}`).toBe(true)
    }
  })

  it('AUCUNE lecture de production ne jette son erreur', () => {
    const fautes = tout
      .flatMap((f) => lecturesSansErreur(f.chemin, f.texte).map((l) => ({ ...l, chemin: f.chemin })))
      .map((l) => `${l.chemin}:${l.ligne} — ${l.champs ?? 'forme non reconnue par ce scanner'}`)
    expect(fautes).toEqual([])
  })
})
