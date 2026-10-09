import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PacksTab from './PacksTab'

// UNE LECTURE PLUS LENTE ÉCRIT EN DERNIER, ET L'ÉCRAN MENT SANS LE DIRE.
//
// L'aperçu d'un pack est le seul chargement du projet dont les dépendances ne sont pas `dossierId` :
// ce sont les DEUX DATES, que l'opérateur change à la main, écran ouvert, plusieurs fois de suite.
// Deux changements rapprochés lancent deux lectures qui se chevauchent, et sans annulation c'est la
// dernière ARRIVÉE qui écrit — pas la dernière demandée.
//
// ET LA COURSE PENCHE TOUJOURS DU MÊME CÔTÉ, ce qui la rend pire qu'un tirage au sort : `lireTout`
// fait d'autant plus d'allers-retours que la période est large, donc la période LARGE est la plus
// lente à revenir. Rétrécir la période est le geste courant, et c'est celui qui laisse à l'écran le
// compte et le total d'avant, sous des dates qui en annoncent une autre. L'opérateur lit un chiffre,
// génère, et le pack ne contient pas cela — sur le livrable qu'on envoie au comptable.
//
// Aucun test de `src/lib` ne peut voir ça : `lireTout` est juste, `packGenerator` est juste, c'est
// l'ORDRE D'ARRIVÉE de deux appels corrects qui produit le mensonge.

type Reponse = { data: unknown[] | null; count: number | null; error: { message: string } | null }

const faux = vi.hoisted(() => ({
  // Une file d'attente par période demandée : le test décide QUAND chaque lecture répond, donc dans
  // quel ordre elles arrivent. Rien ne se résout tout seul.
  enAttente: [] as { periode: string; repondre: (r: Reponse) => void }[],
  periodesDemandees: [] as string[],
  // Les packs déjà générés, que l'écran liste avec leurs deux boutons de téléchargement.
  packs: [] as unknown[],
  // La lecture de l'historique des packs, refusée à la demande.
  erreurPacks: null as string | null,
  // Ce que le point unique d'ouverture rend. Le doublure vaut mieux qu'un vrai `window.open` ici :
  // ce test garde le CÂBLAGE (l'écran dit-il l'échec ?), le comportement du point unique étant
  // gardé à part par `apercu.test.ts`.
  apercu: { ok: true } as { ok: true } | { ok: false; message: string },
  cheminsDemandes: [] as string[],
  // La lecture de l'historique attend que le test la libère (voir `retenirPacks`) : on regarde l'écran PENDANT elle.
  portePacks: null as Promise<void> | null,
  lecturesPacks: 0,
  generations: 0,
  // La génération attend `porteGeneration` quand le test la pose : la fenêtre pendant laquelle un second clic arrive.
  porteGeneration: null as Promise<void> | null,
  // Les lignes `packs` écrites, et le refus que le test peut leur opposer.
  insertionsPacks: [] as unknown[],
  erreurInsertion: null as { message: string } | null,
}))

vi.mock('../../lib/packGenerator', () => ({
  generatePack: async () => {
    faux.generations += 1
    await faux.porteGeneration
    return { nbPieces: 4, totalTtc: 400, storagePathZip: 'd1/p/nouveau.zip', storagePathExcel: 'd1/p/nouveau.xlsx', manquantes: [], sansDate: [] }
  },
}))

vi.mock('../../lib/apercu', () => ({
  ouvrirApercu: (_seau: string, chemin: string) => {
    faux.cheminsDemandes.push(chemin)
    return Promise.resolve(faux.apercu)
  },
}))

vi.mock('../../lib/supabase', () => {
  // Le faux client honore `range` et annonce un `count` : sans l'un la chaîne de `lireTout` casse,
  // sans l'autre TOUTE lecture se déclare incomplète et le test passerait pour une raison fausse
  // (CLAUDE.md — le coût récurrent de `lireTout`, à payer une fois par faux client).
  const chaine = (table: string) => {
    const etat = { debut: '', fin: '', estSansDate: false }
    const self: Record<string, unknown> = {}
    for (const methode of ['select', 'eq', 'order', 'is', 'gte', 'lte', 'range']) {
      self[methode] = (...args: unknown[]) => {
        if (methode === 'gte') etat.debut = String(args[1])
        if (methode === 'lte') etat.fin = String(args[1])
        if (methode === 'is') etat.estSansDate = true
        return self
      }
    }
    // L'enregistrement d'un pack généré : rien d'autre ne s'écrit ici.
    self.insert = (ligne: unknown) => {
      faux.insertionsPacks.push(ligne)
      return Promise.resolve({ error: faux.erreurInsertion })
    }
    self.then = (resolve: (r: Reponse) => void) => {
      if (table === 'packs') {
        faux.lecturesPacks += 1
        // La réponse se compose quand elle PART : une lecture retenue rend l'historique de sa libération.
        const repondrePacks = () => (faux.erreurPacks
          ? resolve({ data: null, count: null, error: { message: faux.erreurPacks } })
          : resolve({ data: faux.packs, count: faux.packs.length, error: null }))
        if (faux.portePacks) { faux.portePacks.then(repondrePacks); return undefined }
        return repondrePacks()
      }
      // Les pièces sans date ne dépendent d'aucune période : elles répondent tout de suite, pour
      // que le test n'ait à ordonner QUE les deux lectures qui courent l'une contre l'autre.
      if (etat.estSansDate) return resolve({ data: [], count: 0, error: null })
      const periode = `${etat.debut}→${etat.fin}`
      faux.periodesDemandees.push(periode)
      faux.enAttente.push({ periode, repondre: resolve })
      return undefined
    }
    return self
  }
  return {
    supabase: {
      from: (table: string) => chaine(table),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    },
  }
})

/** Fait répondre la lecture d'une période donnée, avec N pièces validées à 100 € chacune. */
async function repondre(periode: string, nbValidees: number) {
  const attente = faux.enAttente.find((a) => a.periode === periode)
  if (!attente) throw new Error(`aucune lecture en attente pour ${periode} — demandées : ${faux.periodesDemandees.join(', ')}`)
  faux.enAttente = faux.enAttente.filter((a) => a !== attente)
  const data = Array.from({ length: nbValidees }, () => ({ statut: 'validee', montant_ttc: 100 }))
  await act(async () => { attente.repondre({ data, count: nbValidees, error: null }) })
}

// Retient les lectures suivantes de l'historique jusqu'à ce que le test appelle la fonction rendue.
function retenirPacks(): () => Promise<void> {
  let ouvrir = () => {}
  faux.portePacks = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux.portePacks = null
    await act(async () => { ouvrir() })
  }
}

// Le bloc de l'historique, sous son titre.
function historique(): string {
  const titre = screen.getByRole('heading', { name: 'Historique' })
  let bloc = titre.nextElementSibling
  while (bloc && !bloc.classList.contains('card')) bloc = bloc.nextElementSibling
  return bloc?.textContent ?? ''
}

function changerPeriode(debut: string, fin: string) {
  fireEvent.change(document.querySelector('#debut')!, { target: { value: debut } })
  fireEvent.change(document.querySelector('#fin')!, { target: { value: fin } })
}

beforeEach(() => {
  faux.portePacks = null
  faux.lecturesPacks = 0
  faux.generations = 0
  faux.porteGeneration = null
  faux.insertionsPacks = []
  faux.erreurInsertion = null
  faux.enAttente = []
  faux.periodesDemandees = []
  faux.packs = []
  faux.erreurPacks = null
  faux.apercu = { ok: true }
  faux.cheminsDemandes = []
})

describe('PacksTab — l’aperçu suit la période affichée, pas la lecture la plus lente', () => {
  it('ignore une lecture périmée qui revient après la plus récente', async () => {
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    // La période LARGE est demandée, puis rétrécie avant d'avoir répondu — le geste courant.
    changerPeriode('2026-01-01', '2026-12-31')
    await act(async () => {})
    changerPeriode('2026-07-01', '2026-07-31')
    await act(async () => {})

    // La période étroite répond d'abord (elle a moins de pages à lire), la large ensuite : c'est
    // exactement l'ordre que `lireTout` produit, et c'est lui qui rendait l'écran faux.
    await repondre('2026-07-01→2026-07-31', 4)
    expect(screen.getByText(/4 pièce\(s\) validée\(s\)/)).toBeTruthy()

    await repondre('2026-01-01→2026-12-31', 22)

    // L'écran doit TOUJOURS montrer la période affichée. Sans annulation, il affiche ici 22.
    expect(screen.getByText(/4 pièce\(s\) validée\(s\)/)).toBeTruthy()
    expect(screen.queryAllByText(/22 pièce\(s\) validée\(s\)/)).toHaveLength(0)
  })

  it('accepte bien la lecture de la période affichée — sinon il ne montrerait jamais rien', async () => {
    // Le cas symétrique, sans lequel « l'écran n'affiche pas 22 » serait satisfait par un écran qui
    // n'affiche JAMAIS rien : « zéro faute » et « aveugle » se ressemblent trop (CLAUDE.md).
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    changerPeriode('2026-07-01', '2026-07-31')
    await act(async () => {})
    await repondre('2026-07-01→2026-07-31', 7)

    expect(screen.getByText(/7 pièce\(s\) validée\(s\)/)).toBeTruthy()
  })

  it('laisse la dernière période écrire quand c’est elle qui revient en dernier', async () => {
    // L'ordre NORMAL : la plus récente arrive en dernier et doit s'imposer. Un garde qui refuserait
    // tout ce qui arrive après un changement casserait l'écran au lieu de le réparer.
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    changerPeriode('2026-01-01', '2026-12-31')
    await act(async () => {})
    changerPeriode('2026-07-01', '2026-07-31')
    await act(async () => {})

    await repondre('2026-01-01→2026-12-31', 22)
    await repondre('2026-07-01→2026-07-31', 4)

    expect(screen.getByText(/4 pièce\(s\) validée\(s\)/)).toBeTruthy()
  })
})

// UN BOUTON DE TÉLÉCHARGEMENT NE FAIT JAMAIS RIEN EN SILENCE.
//
// `download` LISAIT son erreur puis faisait `return` : le clic ne produisait ni onglet, ni message,
// sur le livrable qu'on envoie au comptable. C'est mot pour mot le défaut corrigé la veille sur
// l'export d'`InformationsTab`, resté entier sur l'autre chemin de téléchargement du MÊME fichier.
describe('PacksTab — le téléchargement d’un pack', () => {
  function poserUnPack() {
    faux.packs = [{
      id: 'pk1', dossier_id: 'd1', periode_debut: '2026-07-01', periode_fin: '2026-07-31',
      nb_pieces: 4, total_ttc: 400, storage_path_zip: 'd1/p/pack.zip',
      storage_path_excel: 'd1/p/recap.xlsx', created_at: '2026-08-01T09:00:00Z',
    }]
  }

  it('DIT pourquoi quand l’ouverture échoue, au lieu de ne rien faire', async () => {
    poserUnPack()
    faux.apercu = { ok: false, message: "L'ouverture a été bloquée par le navigateur." }
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    const zip = screen.getByRole('button', { name: 'ZIP' })
    await act(async () => { zip.click() })

    expect(faux.cheminsDemandes).toEqual(['d1/p/pack.zip'])
    expect(screen.getByText(/bloquée par le navigateur/)).toBeTruthy()
  })

  it('ne se plaint pas quand l’ouverture réussit', async () => {
    // Garde SYMÉTRIQUE : sans lui, « l'écran dit l'échec » serait satisfait par un écran qui se
    // plaint toujours, y compris sur le téléchargement qui vient de partir.
    poserUnPack()
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    const excel = screen.getByRole('button', { name: 'Excel' })
    await act(async () => { excel.click() })

    expect(faux.cheminsDemandes).toEqual(['d1/p/recap.xlsx'])
    expect(screen.queryAllByText(/bloquée par le navigateur/)).toHaveLength(0)
  })
})

// L'HISTORIQUE LU EN PARTIE LE DIT — et le vide n'y est plus une affirmation.
//
// `loadPacks` jetait son drapeau, et le scanner ne le voyait pas : le nom `lecture` était lu dans la
// fonction VOISINE (l'aperçu), et le contrôle jugeait les noms à l'échelle du fichier. Tronqué,
// l'historique cache un pack déjà généré — donc peut-être déjà envoyé — et invite à le régénérer ;
// refusé, il affirmait « Aucun pack généré », le pire sens possible.
describe('PacksTab — l’historique des packs', () => {
  it('lu en partie, il le dit, et n’affirme pas qu’aucun pack n’a été généré', async () => {
    faux.erreurPacks = 'refus simulé'
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    expect(screen.getByText(/Les packs déjà générés n'ont pas pu être lus en entier \(lecture interrompue après 0 ligne\(s\) : refus simulé\)/)).toBeTruthy()
    expect(screen.queryAllByText(/Aucun pack généré/)).toHaveLength(0)
  })

  it('lu en entier et vide, il dit bien qu’il n’y a aucun pack', async () => {
    // Garde SYMÉTRIQUE : sans lui, « l'écran ne dit plus "aucun pack" sur une panne » serait
    // satisfait par un écran qui ne le dit JAMAIS, et « il signale » par un écran qui signale toujours.
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    expect(screen.getByText(/Aucun pack généré/)).toBeTruthy()
    expect(screen.queryAllByText(/n'ont pas pu être lus/)).toHaveLength(0)
  })
})

// « AUCUN PACK » NE SE DIT QU'UNE FOIS L'HISTORIQUE REVENU, ET L'APERÇU D'UNE AUTRE PÉRIODE NE RESTE PAS SOUS CELLE-CI.
//
// Au premier rendu l'historique est vide faute d'avoir été lu : l'écran disait « Aucun pack généré pour l'instant. » d'un
// dossier dont les packs sont peut-être déjà partis au comptable — et invitait à les régénérer. Et quand les dates
// changent, l'aperçu de la période d'avant (« 22 pièce(s) validée(s) — 2 200,00 € ») restait sous les nouvelles dates
// jusqu'au retour de la lecture.
describe('PacksTab — rien ne s’affirme avant d’avoir été lu', () => {
  function poserUnPack() {
    faux.packs = [{
      id: 'pk1', dossier_id: 'd1', periode_debut: '2026-07-01', periode_fin: '2026-07-31',
      nb_pieces: 4, total_ttc: 400, storage_path_zip: 'd1/p/pack.zip',
      storage_path_excel: 'd1/p/recap.xlsx', created_at: '2026-08-01T09:00:00Z',
    }]
  }

  it('l’historique dit « Chargement… » tant que sa lecture n’est pas revenue, puis ce qu’il a lu', async () => {
    poserUnPack()
    const liberer = retenirPacks()
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })

    expect(faux.lecturesPacks).toBe(1)
    expect(historique()).toBe('Chargement…')
    expect(screen.queryAllByText(/Aucun pack généré/)).toHaveLength(0)

    await liberer()
    expect(await screen.findByRole('button', { name: 'ZIP' })).toBeTruthy()
    expect(historique()).not.toMatch(/Chargement/)
  })

  it('ne dit « aucun pack » d’un dossier sans pack qu’après l’avoir lu', async () => {
    const liberer = retenirPacks()
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })
    expect(screen.queryAllByText(/Aucun pack généré/)).toHaveLength(0)

    await liberer()
    expect(await screen.findByText(/Aucun pack généré/)).toBeTruthy()
  })

  it('la relecture qui suit une génération laisse l’historique déjà lu sous les yeux', async () => {
    // La règle de `ClientUpload` : le chargement ne vaut que pour la PREMIÈRE lecture.
    poserUnPack()
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })
    changerPeriode('2026-07-01', '2026-07-31')
    await act(async () => {})
    await repondre('2026-07-01→2026-07-31', 4)
    await screen.findByRole('button', { name: 'ZIP' })

    const liberer = retenirPacks()
    await act(async () => { screen.getByRole('button', { name: 'Générer le pack' }).click() })

    expect(faux.generations).toBe(1)
    expect(faux.lecturesPacks).toBe(2)
    expect(historique()).not.toMatch(/Chargement/)
    expect(screen.getByRole('button', { name: 'ZIP' })).toBeTruthy()
    await liberer()
  })

  it('l’aperçu d’une autre période s’efface dès que les dates changent', async () => {
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })
    changerPeriode('2026-01-01', '2026-12-31')
    await act(async () => {})
    await repondre('2026-01-01→2026-12-31', 22)
    expect(screen.getByText(/22 pièce\(s\) validée\(s\)/)).toBeTruthy()

    // La période se rétrécit ; sa lecture n'a pas encore répondu.
    changerPeriode('2026-07-01', '2026-07-31')
    await act(async () => {})
    expect(screen.queryAllByText(/22 pièce\(s\) validée\(s\)/)).toHaveLength(0)
    expect((screen.getByRole('button', { name: 'Générer le pack' }) as HTMLButtonElement).disabled).toBe(true)

    await repondre('2026-07-01→2026-07-31', 4)
    expect(screen.getByText(/4 pièce\(s\) validée\(s\)/)).toBeTruthy()
  })

  it('le bandeau d’une période lue en partie s’efface avec elle', async () => {
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })
    changerPeriode('2026-01-01', '2026-12-31')
    await act(async () => {})
    // La période large répond en partie : 3 pièces annoncées, 1 rendue, puis plus rien — `lireTout` redemande la suite.
    for (const data of [[{ statut: 'validee', montant_ttc: 100 }], []]) {
      const attente = faux.enAttente.find((a) => a.periode === '2026-01-01→2026-12-31')!
      faux.enAttente = faux.enAttente.filter((a) => a !== attente)
      await act(async () => { attente.repondre({ data, count: 3, error: null }) })
    }
    expect(screen.getByText(/Les pièces de la période n.ont pas pu être lues en entier/)).toBeTruthy()

    changerPeriode('2026-07-01', '2026-07-31')
    await act(async () => {})
    expect(screen.queryAllByText(/Les pièces de la période n.ont pas pu être lues en entier/)).toHaveLength(0)
  })
})

// « GÉNÉRER LE PACK » NE SE PROTÉGEAIT QUE PAR UN ÉTAT (09/10/2026). `disabled={generating}` ne prend effet qu'au rendu
// suivant : deux clics du même rendu produisaient deux archives et deux lignes `packs` (n'a d'unique que son identifiant)
// — deux livrables identiques dans l'historique, dont l'un, envoyé au comptable, ne se distingue plus de l'autre. Le cas à
// TROIS clics est le seul à distinguer un verrou posé dans le `try`.
describe('PacksTab — le verrou de la génération d’un pack', () => {
  function retenirLaGeneration(): () => Promise<void> {
    let ouvrir = () => {}
    faux.porteGeneration = new Promise<void>((resolve) => { ouvrir = resolve })
    return async () => {
      faux.porteGeneration = null
      await act(async () => { ouvrir() })
    }
  }
  // La période lue, quatre pièces validées : « Générer le pack » s'offre.
  async function pretAGenerer() {
    await act(async () => { render(<PacksTab dossierId="d1" dossierNom="Dossier test" />) })
    changerPeriode('2026-07-01', '2026-07-31')
    await act(async () => {})
    await repondre('2026-07-01→2026-07-31', 4)
    return screen.getByRole('button', { name: 'Générer le pack' }) as HTMLButtonElement
  }

  it('ne génère qu’un pack quand le bouton part deux fois dans le même rendu', async () => {
    const bouton = await pretAGenerer()
    const liberer = retenirLaGeneration()

    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.generations).toBe(1)
    expect(bouton.disabled).toBe(true)
    expect(bouton.textContent).toBe('Génération…')
    await liberer()
    expect(faux.insertionsPacks).toHaveLength(1)
  })

  it('trois clics dans le même rendu n’en génèrent qu’un', async () => {
    const bouton = await pretAGenerer()
    const liberer = retenirLaGeneration()

    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.generations).toBe(1)
    await liberer()
    expect(faux.insertionsPacks).toHaveLength(1)
  })

  it('relâche le verrou sur un refus de la base, pour laisser réessayer', async () => {
    faux.erreurInsertion = { message: 'permission denied' }
    const bouton = await pretAGenerer()

    await act(async () => { bouton.click() })
    expect(screen.getByText(/permission denied/)).toBeTruthy()
    await act(async () => { bouton.click() })

    expect(faux.generations).toBe(2)
  })

  // L'ONGLET RESTE OUVERT SUR CE QU'IL ÉCRIT : tant que l'historique n'est pas relu, il ne porte pas le pack qui vient
  // d'être généré — et l'inviterait à le régénérer. Le verrou ne se relâche qu'après la relecture.
  it('tient le verrou jusqu’à ce que l’historique soit relu', async () => {
    const bouton = await pretAGenerer()
    await screen.findByText(/Aucun pack généré/)
    const libererLHistorique = retenirPacks()

    await act(async () => { bouton.click() })
    expect(faux.generations).toBe(1)
    expect(faux.lecturesPacks).toBe(2)

    await act(async () => { bouton.click() })
    expect(faux.generations).toBe(1)

    await libererLHistorique()
    await act(async () => { bouton.click() })
    expect(faux.generations).toBe(2)
  })
})
