import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// UN VERROU D'EXÉCUTION SE RELÂCHE DANS UN `finally`, JAMAIS EN CLAIR APRÈS L'`await`.
//
// C'est la seconde moitié de la règle du verrou (CLAUDE.md), et elle est restée NON ÉCRITE pendant
// des mois parce qu'elle était seulement PRATIQUÉE : douze porteurs sur quatorze la respectaient
// sans que rien ne l'exige. Les deux autres relâchaient en ligne, et ce sont exactement les deux
// dont l'action SORT de l'application — un e-mail parti chez le client, une facture transmise à une
// plateforme agréée DGFiP.
//
// CE QU'UN RELÂCHEMENT EN LIGNE COÛTE, et pourquoi c'est pire qu'un doublon : toute exception qui
// passe à côté (réseau, bibliothèque, une exception jetée par un `then` de la chaîne) sort de la
// fonction sans rien relâcher. Le verrou reste PRIS et l'état « en cours » reste à true : le bouton
// est grisé, aucun message n'est affiché, et plus rien ne part jusqu'à la réouverture de l'écran.
// Un doublon, au moins, se voit. Un écran figé sans raison est le début d'un ticket — et sur une
// action irréversible, l'utilisateur ne peut même pas savoir si elle est partie.
//
// POURQUOI UN TEST ET PAS UNE RÈGLE ÉCRITE. Les deux défauts ont été trouvés à trois heures
// d'intervalle le 21/09/2026 : le premier en écrivant le test d'écran de `SuperPdpFactureModal`, le
// second par un balayage lancé juste après. Le test d'écran d'`EnvoyerEmailModal` existait déjà
// depuis la veille et son commentaire DISAIT « ici il n'y a pas de `try` » — il avait le défaut sous
// les yeux et l'a traité comme un décor. Une vérification qu'il faut penser à rejouer, et dont
// personne ne peut voir qu'elle est fausse, ne vaut rien (CLAUDE.md).
//
// CE QUE CE TEST NE GARDE PAS, annoncé plutôt que laissé deviner : que le verrou soit posé AVANT le
// `try` (première moitié de la règle). Cela ne se lit pas de façon fiable sur du texte — la pose
// peut vivre dans une fonction imbriquée, derrière une condition — et c'est déjà gardé écran par
// écran, par le cas à TROIS clics de chaque test de modale, qui est le seul à distinguer les deux
// placements.

/**
 * Les verrous dont le relâchement n'a PAS à vivre dans un `finally`, avec la raison qui le justifie.
 *
 * Un `useRef` n'est pas toujours un verrou : « ce composant est déjà initialisé », « cet effet est
 * annulé » s'écrivent pareil et ne se relâchent jamais. Une entrée ici se lit donc comme une
 * affirmation sur ce que le ref SIGNIFIE, pas comme une dispense.
 *
 * Vide à ce jour, et c'est un résultat : les quatorze `*.current = true` de `src` sont tous des
 * verrous d'exécution au sens strict.
 */
const EXCEPTIONS: Record<string, string> = {}

function sourcesDeProduction(dossier: string, trouvees: string[] = []): string[] {
  for (const entree of readdirSync(new URL(`../../${dossier}/`, import.meta.url), { withFileTypes: true })) {
    if (entree.isDirectory()) sourcesDeProduction(`${dossier}/${entree.name}`, trouvees)
    else if (/\.tsx?$/.test(entree.name) && !entree.name.includes('.test.')) trouvees.push(`${dossier}/${entree.name}`)
  }
  return trouvees
}

/**
 * Le `finally { … }` qui ENFERME cette position, s'il y en a un.
 *
 * On part du `finally {` le plus proche EN AMONT et on avance en comptant les accolades : si son
 * bloc s'est refermé avant d'atteindre la position, il ne l'enferme pas. Le sens du doute est
 * délibérément le sens BRUYANT — une position qu'on n'arrive pas à rattacher est déclarée en faute,
 * jamais l'inverse : un scanner qui se tait sur ce qu'il ne comprend pas redevient indiscernable
 * d'un scanner aveugle.
 */
function estDansUnFinally(source: string, position: number): boolean {
  const ouverture = source.lastIndexOf('finally {', position)
  if (ouverture === -1) return false
  let profondeur = 0
  for (let i = ouverture + 'finally {'.length; i < position; i++) {
    if (source[i] === '{') profondeur++
    else if (source[i] === '}') {
      if (profondeur === 0) return false
      profondeur--
    }
  }
  return true
}

export interface VerrouEnFaute {
  fichier: string
  verrou: string
  motif: 'jamais relâché' | 'relâché hors d’un finally'
}

/** Tous les verrous d'une source dont le relâchement ne tient pas dans un `finally`. */
export function verrousEnFaute(fichier: string, source: string): VerrouEnFaute[] {
  const noms = [...new Set([...source.matchAll(/(\w+)\.current = true/g)].map((m) => m[1]))]
  const fautes: VerrouEnFaute[] = []

  for (const nom of noms) {
    if (EXCEPTIONS[`${fichier} [${nom}]`]) continue
    const relachements = [...source.matchAll(new RegExp(`${nom}\\.current = false`, 'g'))].map((m) => m.index)
    if (relachements.length === 0) {
      fautes.push({ fichier, verrou: nom, motif: 'jamais relâché' })
      continue
    }
    if (relachements.some((position) => !estDansUnFinally(source, position))) {
      fautes.push({ fichier, verrou: nom, motif: 'relâché hors d’un finally' })
    }
  }
  return fautes
}

describe('les verrous d’exécution se relâchent dans un finally', () => {
  const sources = sourcesDeProduction('src')

  it('parcourt bien toute la source de production', () => {
    // Sans cette borne, un scanner qui ne lirait plus rien annoncerait « zéro faute » — la panne qui
    // ressemble exactement au succès, et que ce dépôt a déjà payée trois fois.
    expect(sources.length).toBeGreaterThan(80)
    expect(sources.some((f) => f.endsWith('src/components/EnvoyerEmailModal.tsx'))).toBe(true)
  })

  it('trouve des verrous à examiner — sinon il ne garderait rien', () => {
    const total = sources.reduce(
      (n, f) => n + new Set([...readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').matchAll(/(\w+)\.current = true/g)].map((m) => m[1])).size,
      0,
    )
    expect(total).toBeGreaterThanOrEqual(14)
  })

  it('n’en laisse aucun relâcher son verrou hors d’un finally', () => {
    const fautes = sources.flatMap((f) => verrousEnFaute(f, readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')))
    expect(
      fautes.map((f) => `${f.fichier} [${f.verrou}] — ${f.motif}`).join('\n'),
      'un verrou relâché hors d’un `finally` laisse l’écran figé sans message dès qu’une exception passe à côté',
    ).toBe('')
  })

  it('n’admet que des exceptions qui correspondent à un verrou RÉEL', () => {
    // Sans ce contrôle, la liste se remplirait de raisons mortes — une exception laissée après le
    // renommage du ref qu'elle dispensait, et personne pour s'en apercevoir.
    const reels = new Set(
      sources.flatMap((f) =>
        [...new Set([...readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').matchAll(/(\w+)\.current = true/g)].map((m) => m[1]))]
          .map((nom) => `${f} [${nom}]`),
      ),
    )
    for (const cle of Object.keys(EXCEPTIONS)) expect(reels, `exception morte : ${cle}`).toContain(cle)
  })
})

describe('le scanner lui-même — défaut PLANTÉ, pas espéré', () => {
  // « Le scanner rend zéro » et « le scanner est aveugle » se ressemblent trop : on lui donne donc
  // une source SYNTHÉTIQUE portant le défaut dans sa forme exacte, plus deux cas voisins qu'il ne
  // doit PAS attraper. C'est la leçon qui a coûté trois versions du scanner de lectures paginées.
  const fautif = `
    const envoiEnCours = useRef(false)
    async function envoyer() {
      if (envoiEnCours.current) return
      envoiEnCours.current = true
      const { data } = await supabase.functions.invoke('send-email', {})
      envoiEnCours.current = false
      if (data?.error) return
    }
  `
  const correct = `
    const verrou = useRef(false)
    async function lancer() {
      if (verrou.current) return
      verrou.current = true
      try {
        await faireLeTravail()
      } finally {
        verrou.current = false
      }
    }
  `
  // Le piège du comptage d'accolades : un `finally` DÉJÀ REFERMÉ avant le relâchement. Un scanner
  // qui se contenterait de « y a-t-il un `finally` plus haut ? » le laisserait passer.
  const finallyDejaReferme = `
    const verrou = useRef(false)
    async function lancer() {
      verrou.current = true
      try {
        await premierTravail()
      } finally {
        journaliser()
      }
      await secondTravail()
      verrou.current = false
    }
  `
  const jamaisRelache = `
    const monte = useRef(false)
    useEffect(() => { monte.current = true }, [])
  `

  it('attrape un relâchement posé en clair après l’await', () => {
    expect(verrousEnFaute('synthetique.tsx', fautif)).toEqual([
      { fichier: 'synthetique.tsx', verrou: 'envoiEnCours', motif: 'relâché hors d’un finally' },
    ])
  })

  it('attrape un relâchement placé APRÈS un finally déjà refermé', () => {
    expect(verrousEnFaute('synthetique.tsx', finallyDejaReferme)).toHaveLength(1)
  })

  it('attrape un verrou jamais relâché, et le nomme autrement', () => {
    expect(verrousEnFaute('synthetique.tsx', jamaisRelache)).toEqual([
      { fichier: 'synthetique.tsx', verrou: 'monte', motif: 'jamais relâché' },
    ])
  })

  it('ne crie pas au loup sur la forme correcte', () => {
    expect(verrousEnFaute('synthetique.tsx', correct)).toEqual([])
  })

  it('distingue bien les deux issues — sinon il ne prouverait rien', () => {
    // Un scanner qui rendrait TOUT en faute passerait les trois cas ci-dessus sans rien valoir.
    expect(verrousEnFaute('s.tsx', fautif + correct)).toHaveLength(1)
  })
})
