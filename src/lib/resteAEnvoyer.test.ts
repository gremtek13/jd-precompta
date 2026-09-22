import { describe, expect, it } from 'vitest'
import { exercicesAReclamer, moisManquantsDe, pointsUtiles } from './resteAEnvoyer'

// Ce module existe parce que le calcul était écrit TROIS FOIS et avait déjà divergé deux fois. Les
// tests portent donc sur ce qui a divergé : l'appariement année / mois, et la frontière du 1er
// janvier, où la liste repartait à zéro en cessant de réclamer l'exercice qu'on est en train de
// clôturer.

describe('exercicesAReclamer', () => {
  it("réclame l'exercice en cours pour ses seuls mois RÉVOLUS", () => {
    const ex = exercicesAReclamer(2026, 8, [2025])
    expect(ex).toHaveLength(1)
    expect(ex[0].annee).toBe(2026)
    expect(ex[0].enCours).toBe(true)
    // Huit mois révolus : janvier à août. Pas septembre, qui n'est pas fini.
    expect(ex[0].moisAttendus).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it("AU 1ER JANVIER, L'EXERCICE RÉVOLU RESTE RÉCLAMÉ EN ENTIER", () => {
    // Le défaut d'origine : `moisEcoules` vaut 0 le 1er janvier, donc les trois écrans n'avaient
    // plus rien à réclamer — ni pour la nouvelle année (aucun mois révolu), ni pour l'ancienne
    // (qu'ils ne regardaient pas). « Rien à envoyer », au moment précis où le cabinet court après
    // les pièces de l'exercice qu'il clôture.
    const ex = exercicesAReclamer(2027, 0, [])
    expect(ex.map((e) => e.annee)).toEqual([2026, 2027])
    expect(ex[0].moisAttendus).toHaveLength(12)
    expect(ex[0].enCours).toBe(false)
    expect(ex[1].moisAttendus).toEqual([])
  })

  it("cesse de réclamer l'exercice précédent une fois clôturé", () => {
    expect(exercicesAReclamer(2026, 8, [2025]).map((e) => e.annee)).toEqual([2026])
    expect(exercicesAReclamer(2026, 8, [2024]).map((e) => e.annee)).toEqual([2025, 2026])
  })

  it("ne réclame JAMAIS au-delà de l'exercice précédent, même jamais clôturé", () => {
    // Arbitrage écrit dans le module : un dossier ouvert depuis cinq ans dont personne n'a coché la
    // clôture afficherait cinq exercices en permanence, et une mise en garde permanente cesse d'être
    // lue. La borne est donc N-1, pas « tout ce qui n'est pas clos ».
    const ex = exercicesAReclamer(2026, 8, [])
    expect(ex.map((e) => e.annee)).toEqual([2025, 2026])
  })

  it("une liste de clôtures INCONNUE réclame, elle ne se tait pas", () => {
    // Une lecture refusée se passe en liste vide (voir lireAnneesCloturees) : l'échec tombe du côté
    // qui demande un document de trop, jamais du côté qui fabrique une bonne nouvelle.
    expect(exercicesAReclamer(2026, 8, []).map((e) => e.annee)).toEqual([2025, 2026])
  })

  it("l'exercice en cours est toujours rendu, même clôturé par erreur", () => {
    // Clôturer l'année EN COURS est possible (rien ne l'interdit en base) et ne doit pas faire
    // disparaître l'écran de dépôt du client : il lui reste des mois à envoyer.
    const ex = exercicesAReclamer(2026, 8, [2026, 2025])
    expect(ex.map((e) => e.annee)).toEqual([2026])
  })
})

describe('moisManquantsDe', () => {
  const lignes = [
    { date: '2026-01-15' }, { date: '2026-02-03' }, { date: '2026-02-28' },
    { date: '2025-07-01' }, { date: '2025-12-31' },
  ]

  it("ne retient que les mois de SON exercice", () => {
    const [precedent, courant] = exercicesAReclamer(2026, 3, [])
    // 2025 : douze mois attendus, juillet et décembre présents.
    expect(moisManquantsDe(precedent, lignes)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11])
    // 2026 : trois mois attendus, janvier et février présents.
    expect(moisManquantsDe(courant, lignes)).toEqual([3])
  })

  it("UNE LIGNE DE L'AUTRE ANNÉE NE COMBLE PAS UN MOIS", () => {
    // C'est l'appariement exact qui a déjà été fait de travers : un relevé de juillet 2025 ne vaut
    // pas relevé de juillet 2026. Le filtre d'année vit DANS le module, pas chez l'appelant.
    const [courant] = exercicesAReclamer(2026, 8, [2025])
    expect(courant.annee).toBe(2026)
    expect(moisManquantsDe(courant, [{ date: '2025-07-15' }])).toContain(7)
  })

  it('ne réclame rien quand aucun mois n’est encore révolu', () => {
    const [courant] = exercicesAReclamer(2027, 0, [2026])
    expect(courant.annee).toBe(2027)
    expect(moisManquantsDe(courant, [])).toEqual([])
  })
})

describe('pointsUtiles', () => {
  const points = [
    { annee: 2025, ok: true, id: 'banque' },
    { annee: 2025, ok: false, id: 'cotisations' },
    { annee: 2026, ok: true, id: 'banque' },
    { annee: 2026, ok: false, id: 'cotisations' },
  ]

  it("garde tous les points de l'exercice en cours, satisfaits compris", () => {
    // Ils disent où on en est (« 8/8 mois reçus »), ce qui est le métier de cet écran.
    expect(pointsUtiles(points, 2026).filter((p) => p.annee === 2026)).toHaveLength(2)
  })

  it("N'AFFICHE PAS UN POINT SATISFAIT D'UN EXERCICE RÉVOLU", () => {
    // Sans ce filtre, un dossier parfaitement à jour afficherait SIX points pour dire qu'il ne reste
    // rien — et une liste qui passe son temps à ne rien dire cesse d'être lue.
    expect(pointsUtiles(points, 2026).map((p) => `${p.annee}-${p.id}`))
      .toEqual(['2025-cotisations', '2026-banque', '2026-cotisations'])
  })

  it("un exercice révolu entièrement à jour disparaît de la liste", () => {
    const aJour = [{ annee: 2025, ok: true, id: 'a' }, { annee: 2026, ok: true, id: 'a' }]
    expect(pointsUtiles(aJour, 2026)).toHaveLength(1)
  })
})
