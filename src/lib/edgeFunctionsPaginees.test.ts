import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { lireTout, type TrancheLue } from './lectureComplete'

// LE PLAFOND DE POSTGREST S'ARRÊTAIT À `src/` — ET DERRIÈRE, LE PLAFOND DE COÛT IA SE SOUS-ESTIMAIT.
//
// `lecturesPaginees.test.ts` garde depuis le 20/09/2026 la règle « une lecture de collection dit si
// elle est complète ». Il ne balaie que `src/`. C'est, pour la QUATRIÈME fois en deux jours, le même
// demi-chemin : les écritures des Edge Functions avaient été portées le 21/09, leurs lectures le
// 22/09 au matin, la forme de leur scanner d'écritures le 22/09 à midi — et la PAGINATION, jamais.
//
// MESURÉ : 16 lectures de collection non bornées dans les Edge Functions, 12 en faute. Les deux qui
// comptent le plus sont, une fois de plus, des bonnes nouvelles fabriquées.
//
//  • `agent-comptable` — LE PLAFOND DE COÛT IA. Ses deux lectures (les dossiers du cabinet, puis
//    l'usage du mois) sont des `select` nus. Tronquées, elles ne vident pas le compteur : elles le
//    SOUS-ESTIMENT, en retirant les dossiers ou les messages qui tombent au-delà de la coupure.
//    CLAUDE.md nomme cette phrase depuis le 20/09 — « ce qui est la façon exacte dont un plafond
//    cesse de protéger » — et le commentaire posé la veille juste sous cette lecture la CITE, au
//    dessus d'un code qui ne la tenait pas. Famille connue de ce dépôt, quatrième occurrence.
//    Et `agent_conversations` est la table qui grandit le plus vite du projet : une ligne par
//    message, donc la première à franchir le plafond.
//  • `superpdp-sync` — la liste des factures DÉJÀ importées. Vide, elle faisait réimporter toute la
//    page (défaut corrigé le 22/09 au matin) ; TRONQUÉE, elle fait exactement pareil pour tout ce
//    qui tombe au-delà de la coupure, sur un dossier qui a dépassé le plafond. Même raisonnement que
//    `chargerHashsExistants`, qui LÈVE pour cette raison précise.
//  • Les quatre outils de l'assistant (`resume_dossier`, `lister_comptes`, `points_a_traiter`,
//    les catégories de `lister_pieces`) alimentent des COMPTEURS, pas des listes rendues au modèle.
//    « Une liste plafonnée dit qu'elle l'est » ne les couvre donc pas : un total tronqué n'est pas
//    une liste plus courte, c'est un CHIFFRE FAUX annoncé en français à un comptable qui n'ira pas
//    vérifier — et `points_a_traiter` répondrait « rien à signaler » sur un dossier qui porte une
//    anomalie au-delà de la coupure.
//
// LATENT, et mesuré le 22/09/2026 : 2 lignes d'`agent_conversations`, 4 dossiers, 78 pièces,
// 3 écritures, 10 catégories. Comme toute cette famille, ce qui les rend dignes d'être corrigés
// n'est pas un préjudice constaté mais qu'aucun ne PEUT se voir une fois arrivé — et le critère du
// projet ne regarde pas le nombre de lignes d'aujourd'hui : **cette collection peut-elle grandir ?**

/**
 * Les lectures de collection qui n'ont pas à être paginées, avec la raison ET LE NOMBRE.
 *
 * Deux critères seulement, et ils ne sont pas interchangeables :
 *  — la collection est BORNÉE par le modèle (les lignes d'UNE facture) ;
 *  — la troncature tombe du côté FERMÉ (elle fait REFUSER, jamais accorder).
 *
 * Le nombre fait partie de l'exception, comme dans `edgeFunctionsLectures` et `datesUtc` : dispenser
 * une FONCTION dispense tout son fichier, or ces fonctions portent d'autres lectures.
 */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'create-client-access': {
    nombre: 1,
    raison:
      'les dossiers du cabinet, dans `appartientDejaAuCabinet`. Tronquée, la liste fait manquer le ' +
      '`membership` cherché, donc la fonction rend `false` et l’appelant REFUSE en 409 : le côté ' +
      'FERMÉ, sur la garde contre la prise de contrôle d’un compte déjà inscrit ailleurs',
  },
  'create-team-member': {
    nombre: 1,
    raison: 'la copie auto-portée exacte de la précédente, même fonction et même refus en 409',
  },
  'send-email': {
    nombre: 1,
    raison:
      'les lignes d’UNE facture, bornées par le modèle — même exception que dans ' +
      '`lecturesPaginees.test.ts` côté `src/`',
  },
  'superpdp-emit': {
    nombre: 1,
    raison: 'les lignes d’UNE facture, bornées par le modèle, pour la transmission au format CII',
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

export interface LectureNonBornee {
  fonction: string
  ligne: number
  table: string
}

/**
 * Les lectures de collection dont rien ne borne la taille.
 *
 * Le corps d'une chaîne s'arrête au `.from(` SUIVANT — la borne apprise par `lecturesPaginees` après
 * s'être fait avaler les chaînes voisines : un `.from(` ne peut pas appartenir à la chaîne en cours,
 * donc on ne peut plus en sauter un.
 *
 * Ce qui BORNE, et rien d'autre : `count: "exact"` (le compte annoncé, sans quoi `lireTout` se
 * déclare incomplète) ou `.limit(` (un plafond assumé, qui va de pair avec le drapeau `tronque` des
 * outils de l'assistant). Ce qui n'est pas une collection s'écarte de soi-même : `.single()`,
 * `.maybeSingle()` et `head: true` ne rapatrient jamais de liste.
 */
export function lecturesNonBornees(fonction: string, source: string): LectureNonBornee[] {
  const code = sansCommentairesPleins(source)
  const trouvees: LectureNonBornee[] = []
  const motif = /\.\s*from\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = motif.exec(code)) !== null) {
    const suivant = code.indexOf('.from(', m.index + m[0].length)
    const corps = code.slice(m.index, suivant === -1 ? code.length : suivant)
    if (!/\.\s*select\s*\(/.test(corps)) continue
    if (/\.\s*(single|maybeSingle)\s*\(/.test(corps)) continue
    if (/head\s*:\s*true/.test(corps)) continue
    if (/count\s*:\s*["']exact["']/.test(corps) || /\.\s*limit\s*\(/.test(corps)) continue
    trouvees.push({ fonction, ligne: code.slice(0, m.index).split('\n').length, table: m[1] })
  }
  const dispense = EXCEPTIONS[fonction]?.nombre ?? 0
  return trouvees.slice(dispense)
}

describe('les lectures de collection des Edge Functions disent si elles sont complètes', () => {
  const toutes = fonctions()

  it('parcourt bien toutes les fonctions, et voit bien des lectures', () => {
    // Les deux bornes qui rendent « zéro faute » distinguable d'« aveugle ».
    expect(toutes.length).toBeGreaterThanOrEqual(12)
    const lectures = toutes.reduce(
      (n, f) => n + (sansCommentairesPleins(sourceDe(f)).match(/\.\s*from\s*\(/g)?.length ?? 0),
      0,
    )
    expect(lectures).toBeGreaterThan(40)
  })

  it('n’en laisse aucune sans borne', () => {
    const fautes = toutes.flatMap((f) => lecturesNonBornees(f, sourceDe(f)))
    expect(
      fautes.map((f) => `${f.fonction}:${f.ligne} — ${f.table}`).join('\n'),
      'PostgREST tronque en silence : une collection lue sans compte annoncé rend un sous-ensemble',
    ).toBe('')
  })

  it('n’admet que des exceptions qui correspondent à un nombre RÉEL', () => {
    for (const [fonction, { nombre }] of Object.entries(EXCEPTIONS)) {
      const brut = lecturesNonBornees(`__${fonction}__`, sourceDe(fonction))
      expect(brut.length, `exception morte ou sous-évaluée : ${fonction}`).toBe(nombre)
    }
  })
})

// ── LE GARDE DE DUPLICATION ──────────────────────────────────────────────────────────────────────
// Deux Edge Functions portent désormais une copie auto-portée de `lireTout`. Une copie qui dérive ne
// casse RIEN de visible : elle rend une liste plus courte, exactement ce que ce module existe pour
// empêcher. On ne la relit donc pas, on l'EXÉCUTE — et jamais contre l'autre copie, mais contre
// celle de `src/lib`, extérieure aux deux. La leçon est celle d'`agentComptableAnalyse` : comparer
// deux copies l'une à l'autre devient une tautologie dès qu'un chemin les confond.
function lireToutDeployee(fonction: string) {
  const source = sourceDe(fonction)
  const debut = source.indexOf('// ── DÉBUT PAGINATION')
  const fin = source.indexOf('// ── FIN PAGINATION')
  expect(debut, `bornes de pagination introuvables dans ${fonction}`).toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)

  const bloc = source.slice(debut, fin)
  expect(bloc, `\`lireTout\` absente du bloc gardé de ${fonction}`).toContain('async function lireTout<T>(')
  // Le bloc est du TypeScript (interfaces, génériques) : on le transpile avec le compilateur du
  // projet plutôt qu'avec un retrait de types écrit à la main, qui mentirait au premier cas tordu.
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}; return lireTout`)() as typeof lireTout
}

/** Un faux serveur PostgREST : il PLAFONNE ses tranches, et peut cesser de rendre en cours de route. */
function serveur(lignes: number[], plafond: number, options: { compte?: number | null; muetApres?: number; erreurApres?: number } = {}) {
  let servies = 0
  return (debut: number, fin: number): Promise<TrancheLue<number>> => {
    if (options.erreurApres != null && servies >= options.erreurApres) {
      return Promise.resolve({ data: null, error: { message: 'refus du serveur' }, count: null })
    }
    const tranche = options.muetApres != null && servies >= options.muetApres
      ? []
      : lignes.slice(debut, Math.min(fin + 1, debut + plafond))
    servies += tranche.length
    return Promise.resolve({
      data: tranche,
      error: null,
      count: options.compte === undefined ? lignes.length : options.compte,
    })
  }
}

const CAS: { nom: string; fabrique: () => (d: number, f: number) => Promise<TrancheLue<number>> }[] = [
  { nom: 'le serveur plafonne à 2 alors qu’on demande 500', fabrique: () => serveur([1, 2, 3, 4, 5], 2) },
  { nom: 'table vide, compte annoncé à zéro', fabrique: () => serveur([], 500) },
  { nom: 'aucun compte annoncé — donc INCOMPLÈTE', fabrique: () => serveur([1, 2, 3], 500, { compte: null }) },
  { nom: 'le serveur se tait en annonçant toujours le vrai total', fabrique: () => serveur([1, 2, 3, 4, 5], 2, { muetApres: 2 }) },
  { nom: 'le serveur refuse en cours de route', fabrique: () => serveur([1, 2, 3, 4, 5], 2, { erreurApres: 2 }) },
  { nom: 'une seule tranche suffit', fabrique: () => serveur([1, 2, 3], 500) },
]

// POURQUOI LA RÉFÉRENCE EXTÉRIEURE EST LA MOITIÉ DU GARDE, MESURÉ PLUTÔT QU'AFFIRMÉ :
// remplacer `lireTout` par `copie` dans le calcul d'`attendu` laisse les 23 tests au VERT — c'est
// une tautologie, donc elle ne peut pas mordre seule. Ce qui compte est la COMBINAISON : la même
// tautologie PLUS une vraie dérive plantée dans la copie déployée (avancer de la taille demandée au
// lieu du rendu) laisse elle aussi les 23 tests au vert, alors que la dérive seule en fait tomber
// un. Une comparaison entre deux copies ne voit donc rien, et c'est exactement l'aveuglement trouvé
// sur `agentComptableAnalyse`.
describe.each(['agent-comptable', 'superpdp-sync'])('la copie de lireTout dans %s', (fonction) => {
  const copie = lireToutDeployee(fonction)

  it('n’est pas la fonction de src/ elle-même — sinon la comparaison serait une tautologie', () => {
    expect(copie).not.toBe(lireTout)
  })

  it.each(CAS)('se comporte comme celle de src/ — $nom', async ({ fabrique }) => {
    const attendu = await lireTout<number>(fabrique())
    const obtenu = await copie<number>(fabrique())
    expect(obtenu).toEqual(attendu)
  })

  it('les deux bornes du bloc encadrent bien la boucle, pas seulement sa signature', () => {
    // Sans ce contrôle, déplacer la boucle hors des bornes laisserait le garde extraire une
    // fonction correcte et la production tourner sur une autre.
    const source = sourceDe(fonction)
    const bloc = source.slice(source.indexOf('// ── DÉBUT PAGINATION'), source.indexOf('// ── FIN PAGINATION'))
    expect(bloc).toContain('annonce != null && lignes.length >= annonce')
    expect(source.split('async function lireTout<T>(').length, 'une seconde définition de lireTout').toBe(2)
  })
})

describe('le scanner lui-même — défauts PLANTÉS, pas espérés', () => {
  const nue = `
    const { data } = await admin.from("agent_conversations").select("tokens_entree").eq("role", "assistant")
  `
  const paginee = `
    const lu = await lireTout((debut, fin) =>
      admin.from("agent_conversations").select("tokens_entree", { count: "exact" }).order("id").range(debut, fin))
  `
  const plafonnee = `
    const { data, count } = await admin.from("pieces").select("id").limit(100)
  `
  const uneLigne = `
    const { data } = await admin.from("cabinets").select("limite_ia_alerte_usd").eq("id", cabinetId).single()
  `
  const compteSeul = `
    const r = await admin.from("pieces").select("id", { count: "exact", head: true }).eq("dossier_id", id)
  `
  const ecriture = `
    const { error } = await admin.from("emails_envoyes").insert({ resend_id: id })
  `
  // La forme qui avait aveuglé `lecturesPaginees` : une lecture nue COINCÉE entre deux lectures
  // correctes, que la borne au `.from(` suivant est seule à rattraper.
  const coincee = paginee + nue + plafonnee

  it('attrape une lecture de collection sans borne', () => {
    expect(lecturesNonBornees('synthetique', nue)).toEqual([
      { fonction: 'synthetique', ligne: 2, table: 'agent_conversations' },
    ])
  })

  it('laisse passer une lecture paginée, une lecture plafonnée, une ligne unique, un compte seul et une écriture', () => {
    expect(lecturesNonBornees('synthetique', paginee)).toEqual([])
    expect(lecturesNonBornees('synthetique', plafonnee)).toEqual([])
    expect(lecturesNonBornees('synthetique', uneLigne)).toEqual([])
    expect(lecturesNonBornees('synthetique', compteSeul)).toEqual([])
    expect(lecturesNonBornees('synthetique', ecriture)).toEqual([])
  })

  it('voit la lecture nue COINCÉE entre deux correctes — la borne au `.from(` suivant', () => {
    expect(lecturesNonBornees('synthetique', coincee)).toHaveLength(1)
    expect(lecturesNonBornees('synthetique', coincee)[0].table).toBe('agent_conversations')
  })

  it('ne voit rien dans une ligne entièrement en commentaire', () => {
    expect(lecturesNonBornees('synthetique', '    // await admin.from("pieces").select("id")\n')).toEqual([])
  })
})
