import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { AuthWeakPasswordError, FunctionsHttpError } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccesTab from './AccesTab'
import { CE_QUE_DISENT_LES_CASES, CE_QUE_DONNE_UN_ACCES } from '../../lib/droitsAcces'
import { REGLE_DU_MOT_DE_PASSE, refusDuMotDePasse } from '../../lib/recuperationMotDePasse'

// L'ÉCRAN QUI DIT QUI PEUT ENTRER DANS UN DOSSIER, et il se trompait dans les deux sens.
//
// « Aucun accès client pour ce dossier » est une AFFIRMATION, pas un écran vide : une lecture
// refusée rendait exactement la même chose, et c'est le pire sens possible pour ce geste-là —
// on coupe l'accès d'un client qui part, et on croit l'avoir fait.
//
// Et « Retirer » partait sans rien demander, dans une colonne d'actions où il voisine
// « Relancer ». Il ne se défait pas d'un clic : il faut recréer l'accès.
//
// Aucun test de `src/lib` ne peut voir l'un ni l'autre : il n'y a pas de calcul ici, seulement un
// écran qui affirme ou qui se tait.
//
// Le troisième geste de l'écran, la CRÉATION d'un accès, porte un verrou d'exécution posé par la
// Routine du 24/09/2026 (commit fa0454a sur `main`), avec ses trois cas repris tels quels plus bas.
// La base rattrape bien le doublon d'ACCÈS (`memberships` est unique par utilisateur et dossier),
// mais pas le doublon d'APPEL : deux soumissions rapprochées lancent deux `create-client-access`
// pour la même adresse, et le second échoue sur le compte que le premier vient de créer — un
// message d'erreur affiché sur un accès pourtant bien créé.
//
// Le quatrième, depuis l'espace client (étape P1) : les DEUX CASES de chaque accès, « Ventes » et « Banque », écrites par
// `changer_droits_acces` sous un verrou relâché après la relecture, jamais offertes sur une liste pas encore revenue ou lue
// en partie.
type LigneAcces = {
  id: string; user_id: string; email: string | null; dossier_id: string; created_at: string
  droit_ventes: unknown; droit_banque: unknown
}

const faux = vi.hoisted(() => ({
  lignes: [] as LigneAcces[],
  erreurLecture: null as { message: string } | null,
  // Le total que la base annonce, quand il doit mentir : plus grand que ce qu'elle rend, la liste est lue en partie.
  compteAnnonce: null as number | null,
  erreurSuppression: null as { message: string } | null,
  suppressions: 0,
  // create-client-access : la promesse du premier appel reste EN ATTENTE, c'est la fenêtre réelle
  // pendant laquelle une seconde soumission arrive. La résoudre tout de suite supprimerait la fenêtre
  // que le verrou ferme.
  appels: [] as unknown[],
  resoudre: null as null | ((v: unknown) => void),
  // La lecture des accès attend que le test la libère (voir `retenir`) : c'est ainsi qu'on regarde l'écran PENDANT la
  // lecture, au lieu de parier sur la vitesse du faux client.
  porte: null as Promise<void> | null,
  lectures: 0,
  // `changer_droits_acces` : ses appels, sa réponse retenue au besoin, ou une réponse imposée (un refus).
  appelsRpc: [] as { nom: string; args: Record<string, unknown> }[],
  porteRpc: null as Promise<void> | null,
  reponseRpc: null as null | { data: unknown; error: unknown },
  // Le lien de réinitialisation : un DOUBLE du service d'authentification, qui n'envoie rien à personne. Ses appels, sa
  // réponse retenue au besoin, l'erreur qu'il rend ou l'exception qu'il lève.
  appelsLien: [] as { adresse: string; options: unknown }[],
  porteLien: null as Promise<void> | null,
  erreurLien: null as unknown,
  exceptionLien: null as unknown,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  // Ce que fait la fonction en base (migration droits_des_acces_clients) : un accès inconnu se refuse comme un accès
  // interdit, un droit nul reste tel quel, et l'accès rendu est celui que l'écriture a laissé.
  function changerDroitsAcces(args: Record<string, unknown>) {
    const acces = faux.lignes.find((l) => l.id === args.p_membership_id)
    if (!acces) return { data: null, error: { message: 'Accès refusé à ce dossier.', code: '42501' } }
    if (args.p_ventes === null && args.p_banque === null) {
      return { data: null, error: { message: 'Aucun droit à changer : précise « Ventes », « Banque », ou les deux.', code: '22023' } }
    }
    if (args.p_ventes !== null) acces.droit_ventes = args.p_ventes
    if (args.p_banque !== null) acces.droit_banque = args.p_banque
    return { data: { ...acces }, error: null }
  }
  return {
    supabase: {
      from: () => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        const tri: string[] = []
        let suppression = false
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const chaine: Record<string, unknown> = {}
        Object.assign(chaine, {
          select: () => chaine,
          delete: () => { suppression = true; faux.suppressions += 1; return chaine },
          eq: (colonne: string, valeur: unknown) => {
            if (suppression) return Promise.resolve({ error: faux.erreurSuppression })
            predicats.push(predicatEq(colonne, valeur))
            return chaine
          },
          order: (colonne: string) => { tri.push(colonne); return chaine },
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          then: (suite: (r: { data: unknown[] | null; error: unknown; count: number | null }) => unknown) => {
            faux.lectures += 1
            // La réponse se compose quand elle PART : une lecture retenue rend l'état de la base à sa libération.
            const repondre = () => {
              if (faux.erreurLecture) return { data: null, error: faux.erreurLecture, count: null }
              const lignes = [...filtrer(faux.lignes, predicats)].sort((a, b) =>
                tri.map((c) => String(a[c as keyof LigneAcces])).join('\u0000')
                  .localeCompare(tri.map((c) => String(b[c as keyof LigneAcces])).join('\u0000')))
              return { data: lignes.slice(debut, fin + 1).map((l) => ({ ...l })), error: null, count: faux.compteAnnonce ?? lignes.length }
            }
            return (faux.porte ? faux.porte.then(repondre) : Promise.resolve(repondre())).then(suite)
          },
        })
        return chaine
      },
      functions: {
        invoke: (nom: string, options: unknown) => {
          faux.appels.push({ nom, options })
          return new Promise((resolve) => { faux.resoudre = resolve })
        },
      },
      auth: {
        resetPasswordForEmail: (adresse: string, options: unknown) => {
          faux.appelsLien.push({ adresse, options })
          const repondre = () => {
            if (faux.exceptionLien) throw faux.exceptionLien
            return { data: faux.erreurLien ? null : {}, error: faux.erreurLien }
          }
          return faux.porteLien ? faux.porteLien.then(repondre) : Promise.resolve().then(repondre)
        },
      },
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.appelsRpc.push({ nom, args })
        const repondre = () => faux.reponseRpc ?? changerDroitsAcces(args)
        return faux.porteRpc ? faux.porteRpc.then(repondre) : Promise.resolve(repondre())
      },
    },
  }
})

// La modale de relance fait ses propres appels et n'a rien à voir avec ce qu'on garde ici.
vi.mock('../../components/EnvoyerEmailModal', () => ({ default: () => null }))

function monter() {
  return render(<AccesTab dossierId="d1" dossierNom="Cabinet Martin" codeEmail="abc123" />)
}

// Un mot de passe initial qui suit la règle du projet (lib/recuperationMotDePasse.ts) : sans elle, le formulaire refuse
// avant tout appel.
const MOT_DE_PASSE = 'Mot-de-passe-1'

const acces = (o: Partial<LigneAcces> & { id: string }): LigneAcces => ({
  user_id: `u-${o.id}`, email: null, dossier_id: 'd1', created_at: '2026-10-01T08:00:00Z', droit_ventes: false, droit_banque: false, ...o,
})

// Retient les lectures suivantes jusqu'à ce que le test appelle la fonction rendue.
function retenir(): () => Promise<void> {
  let ouvrir = () => {}
  faux.porte = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux.porte = null
    await act(async () => { ouvrir() })
  }
}

// Retient la réponse de `changer_droits_acces` : la fenêtre pendant laquelle un second clic arrive.
function retenirLEcriture(): () => Promise<void> {
  let ouvrir = () => {}
  faux.porteRpc = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux.porteRpc = null
    await act(async () => { ouvrir() })
  }
}

// Un tour d'horloge DANS l'`act` : ce que l'écran avait à faire des réponses déjà livrées est rendu avant qu'on le regarde.
function laisserPasserUnTour() {
  return act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
}

async function cliquerRetirer() {
  // « Retirer » vit dans la ligne du client, à côté de « Relancer » : on s'ancre sur l'adresse.
  // Attendue HORS de l'`act` : la ligne n'existe qu'une fois la lecture revenue.
  const ligne = (await screen.findByText('client@exemple.fr')).closest('tr')
  if (!ligne) throw new Error('ligne de l’accès introuvable')
  await act(async () => { within(ligne).getByRole('button', { name: /^Retirer$/ }).click() })
}

const caseDe = (droit: 'Ventes' | 'Banque', personne = 'client@exemple.fr') =>
  screen.getByRole<HTMLInputElement>('checkbox', { name: `Droit « ${droit} » de ${personne}` })

beforeEach(() => {
  faux.porte = null
  faux.lectures = 0
  faux.lignes = [acces({ id: 'm1', user_id: 'u1', email: 'client@exemple.fr' })]
  faux.erreurLecture = null
  faux.compteAnnonce = null
  faux.erreurSuppression = null
  faux.suppressions = 0
  faux.appels = []
  faux.resoudre = null
  faux.appelsRpc = []
  faux.porteRpc = null
  faux.reponseRpc = null
  faux.appelsLien = []
  faux.porteLien = null
  faux.erreurLien = null
  faux.exceptionLien = null
  window.confirm = () => true
})

describe('« Aucun accès » est une affirmation, pas un écran vide', () => {
  it('DIT que la liste n’a pas pu être lue, au lieu d’affirmer qu’il n’y a personne', async () => {
    faux.erreurLecture = { message: 'JWT expired' }
    monter()

    expect(await screen.findByText(/JWT expired/)).toBeTruthy()
    expect(screen.getByText(/ne pas en conclure que personne ne l'a/)).toBeTruthy()
    expect(screen.queryAllByText(/Aucun accès client pour ce dossier/)).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('dit « aucun accès » quand il n’y en a vraiment aucun', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « l'écran n'affirme pas » serait satisfait par un écran qui
    // crie à l'erreur sur un dossier neuf, c'est-à-dire le cas le plus courant.
    faux.lignes = []
    faux.erreurLecture = null
    monter()

    expect(await screen.findByText(/Aucun accès client pour ce dossier/)).toBeTruthy()
  })

  it('ne lit que les accès de SON dossier', async () => {
    faux.lignes = [
      acces({ id: 'm1', user_id: 'u1', email: 'client@exemple.fr' }),
      acces({ id: 'm9', user_id: 'u9', email: 'ailleurs@exemple.fr', dossier_id: 'd9' }),
    ]
    monter()
    expect(await screen.findByText('client@exemple.fr')).toBeTruthy()
    expect(screen.queryAllByText('ailleurs@exemple.fr')).toHaveLength(0)
  })
})

describe('« Aucun accès » ne se dit qu’une fois la liste revenue', () => {
  // Au premier rendu la liste est vide faute d'avoir été lue : l'écran disait « Aucun accès client pour ce dossier. » d'un
  // dossier qui en a un — le pire sens pour cet écran-là, celui où l'on vérifie qu'un client qui part n'entre plus.
  it('dit « Chargement… » tant que la lecture n’est pas revenue, puis la liste lue', async () => {
    const liberer = retenir()
    monter()
    await laisserPasserUnTour()

    expect(faux.lectures).toBe(1)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryAllByText(/Aucun accès client pour ce dossier/)).toHaveLength(0)
    expect(screen.queryAllByText('client@exemple.fr')).toHaveLength(0)

    await liberer()
    expect(await screen.findByText('client@exemple.fr')).toBeTruthy()
    expect(screen.queryAllByText('Chargement…')).toHaveLength(0)
  })

  it('ne dit « aucun accès » d’un dossier vide qu’après l’avoir lu', async () => {
    faux.lignes = []
    const liberer = retenir()
    monter()
    await laisserPasserUnTour()
    expect(screen.queryAllByText(/Aucun accès client pour ce dossier/)).toHaveLength(0)

    await liberer()
    expect(await screen.findByText(/Aucun accès client pour ce dossier/)).toBeTruthy()
  })

  it('une lecture refusée laisse le refus, pas « Chargement… »', async () => {
    faux.erreurLecture = { message: 'JWT expired' }
    const liberer = retenir()
    monter()
    await laisserPasserUnTour()
    await liberer()

    expect(await screen.findByText(/JWT expired/)).toBeTruthy()
    expect(screen.queryAllByText('Chargement…')).toHaveLength(0)
  })

  it('une lecture plus lente qu’une suivante ne réécrit pas la liste après elle', async () => {
    // Un retrait puis une création rapprochés : deux relectures en vol. La plus ancienne revient la dernière, avec la base
    // d'avant la création ; laissée écrire, elle ferait disparaître l'accès qui vient d'être créé.
    monter()
    await screen.findByText('client@exemple.fr')
    const libererLaPremiere = retenir()
    window.confirm = () => true
    await cliquerRetirer()
    const libererLaSeconde = retenir()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email du client'), { target: { value: 'nouveau@exemple.fr' } })
      fireEvent.change(screen.getByLabelText('Mot de passe initial'), { target: { value: MOT_DE_PASSE } })
    })
    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    await act(async () => { faux.resoudre?.({ data: { ok: true }, error: null }) })
    expect(faux.lectures).toBe(3)

    faux.lignes = [...faux.lignes, acces({ id: 'm3', user_id: 'u3', email: 'nouveau@exemple.fr', created_at: '2026-10-03T08:00:00Z' })]
    await libererLaSeconde()
    expect(await screen.findByText('nouveau@exemple.fr')).toBeTruthy()

    // La première relecture revient enfin, avec l'état d'avant la création.
    faux.lignes = faux.lignes.filter((l) => l.id !== 'm3')
    await libererLaPremiere()
    await laisserPasserUnTour()
    expect(screen.getByText('nouveau@exemple.fr')).toBeTruthy()
  })

  it('la relecture qui suit un retrait laisse sous les yeux la liste déjà lue', async () => {
    // La règle de `ClientUpload` : le chargement ne vaut que pour la PREMIÈRE lecture.
    monter()
    await screen.findByText('client@exemple.fr')
    const liberer = retenir()
    await cliquerRetirer()
    await laisserPasserUnTour()

    expect(faux.lectures).toBe(2)
    expect(screen.getByText('client@exemple.fr')).toBeTruthy()
    expect(screen.queryAllByText('Chargement…')).toHaveLength(0)
    await liberer()
  })
})

describe('retirer un accès client : on demande avant, on dit après', () => {
  it('ne retire rien quand la confirmation est refusée', async () => {
    window.confirm = () => false
    monter()
    await cliquerRetirer()
    expect(faux.suppressions).toBe(0)
  })

  it('NOMME le client dans la question posée', async () => {
    let question = ''
    window.confirm = (m?: string) => { question = m ?? ''; return false }
    monter()
    await cliquerRetirer()
    expect(question).toContain('client@exemple.fr')
    // Un accès sans droit n'a rien d'autre à perdre.
    expect(question).not.toContain('droits')
    // Et elle ne promet pas de nouveau mot de passe : un accès recréé reprend le même compte, qui garde le sien
    // (décision du cabinet du 10/10/2026).
    expect(question).not.toContain('mot de passe')
  })

  it('NOMME les droits que l’accès emporte avec lui', async () => {
    faux.lignes = [acces({ id: 'm1', user_id: 'u1', email: 'client@exemple.fr', droit_banque: true })]
    let question = ''
    window.confirm = (m?: string) => { question = m ?? ''; return false }
    monter()
    await cliquerRetirer()
    expect(question).toContain('Ses droits « Banque » partent avec lui : un nouvel accès n\'en a pas, il faudra les recocher.')
    expect(question).not.toContain('« Ventes »')
  })

  it('DIT pourquoi quand le retrait échoue', async () => {
    // Le `load()` qui suit montre normalement l'échec — la ligne réapparaît — SAUF quand il échoue
    // pour la même raison : la liste se vide alors au lieu de garder sa ligne, ce qui retourne le
    // signal au lieu de le donner.
    faux.erreurSuppression = { message: 'permission denied' }
    monter()
    await cliquerRetirer()

    expect(faux.suppressions).toBe(1)
    expect(screen.getByText(/permission denied/)).toBeTruthy()
  })

  it('retire sans rien dire quand tout se passe bien', async () => {
    monter()
    await cliquerRetirer()

    expect(faux.suppressions).toBe(1)
    expect(screen.queryAllByText(/n'a pas pu être retiré/)).toHaveLength(0)
  })
})

async function monterFormulaireRempli() {
  render(<AccesTab dossierId="d1" dossierNom="Dossier Test" codeEmail={null} />)
  // Champs requis (HTML `required`) : jsdom bloque la soumission d'un formulaire tant qu'ils sont
  // vides, donc sans ça le clic n'atteindrait jamais `handleCreateAccess`.
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Email du client'), { target: { value: 'client@exemple.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe initial'), { target: { value: MOT_DE_PASSE } })
  })
  return screen.getByRole('button', { name: /Créer l'accès/ })
}

describe('AccesTab — le verrou de création d’un accès client', () => {
  it("n'appelle qu'une fois create-client-access quand on soumet deux fois de suite", async () => {
    const bouton = await monterFormulaireRempli()

    // LES DEUX SOUMISSIONS DANS LE MÊME `act`. Deux `fireEvent.click` successifs ouvrent chacun leur
    // `act`, qui rend le composant en sortant : le second tomberait sur un bouton déjà re-rendu, avec
    // `inviting` à jour, et le test resterait VERT avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.appels).toHaveLength(1)
  })

  // IL FAUT TROIS CLICS pour distinguer un verrou posé avant le `try` d'un verrou posé dedans : si la
  // vérification/pose du verrou vivait DANS le `try`, le `return` du deuxième clic sortirait par le
  // `finally`, qui relâcherait le verrou du PREMIER, encore en cours, et le troisième clic repartirait
  // pour un second appel (CLAUDE.md, motif déjà vu sur FactureAvoirModal et consorts).
  it("un troisième clic ne déclenche pas de second appel", async () => {
    const bouton = await monterFormulaireRempli()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toHaveLength(1)
  })

  it('relâche le verrou sur un échec, pour laisser réessayer', async () => {
    const bouton = await monterFormulaireRempli()
    await act(async () => { bouton.click() })
    expect(faux.appels).toHaveLength(1)

    // La fonction répond une erreur : `handleCreateAccess` l'attrape et son `finally` doit relâcher
    // le verrou — sinon le formulaire resterait bloqué jusqu'au rechargement de l'onglet.
    await act(async () => { faux.resoudre?.({ data: { error: 'Adresse refusée' }, error: null }) })
    expect(screen.getByText(/Adresse refusée/)).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    expect(faux.appels).toHaveLength(2)
  })
})

// LES DEUX CASES D'UN ACCÈS (espace client, étape P1).
describe('AccesTab — les droits « Ventes » et « Banque » de chaque accès', () => {
  beforeEach(() => {
    faux.lignes = [
      acces({ id: 'm1', user_id: 'u1', email: 'client@exemple.fr', droit_ventes: true }),
      acces({ id: 'm2', user_id: 'u2', email: 'secretariat@exemple.fr', created_at: '2026-10-02T08:00:00Z' }),
    ]
  })

  it('chaque accès porte ses deux cases, cochées comme la base les tient', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    expect(caseDe('Ventes').checked).toBe(true)
    expect(caseDe('Banque').checked).toBe(false)
    expect(caseDe('Ventes', 'secretariat@exemple.fr').checked).toBe(false)
    expect(caseDe('Banque', 'secretariat@exemple.fr').checked).toBe(false)
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
  })

  it('une valeur qui n’est pas strictement vraie ne coche rien', async () => {
    faux.lignes = [acces({ id: 'm1', user_id: 'u1', email: 'client@exemple.fr', droit_ventes: 'true', droit_banque: null })]
    monter()
    await screen.findByText('client@exemple.fr')
    expect(caseDe('Ventes').checked).toBe(false)
    expect(caseDe('Banque').checked).toBe(false)
  })

  it('cocher une case écrit CE droit seul par changer_droits_acces, puis relit : la case montre ce que la base a gardé', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    expect(faux.lectures).toBe(1)

    await act(async () => { caseDe('Banque', 'secretariat@exemple.fr').click() })

    expect(faux.appelsRpc).toEqual([
      { nom: 'changer_droits_acces', args: { p_membership_id: 'm2', p_ventes: null, p_banque: true } },
    ])
    expect(faux.lectures).toBe(2)
    expect(caseDe('Banque', 'secretariat@exemple.fr').checked).toBe(true)
    expect(caseDe('Ventes', 'secretariat@exemple.fr').checked).toBe(false)
    // L'autre accès n'a pas bougé.
    expect(caseDe('Ventes').checked).toBe(true)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('décocher retire le droit, et seulement lui', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { caseDe('Ventes').click() })
    expect(faux.appelsRpc.map((a) => a.args)).toEqual([{ p_membership_id: 'm1', p_ventes: false, p_banque: null }])
    expect(caseDe('Ventes').checked).toBe(false)
  })

  it('deux clics du même rendu n’écrivent qu’une fois', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    const liberer = retenirLEcriture()
    // DANS LE MÊME `act`, comme pour tout verrou. Ici le second clic trouve pourtant déjà la case grisée : React vide les
    // mises à jour d'une entrée contrôlée à la fin de l'événement. Ce test garde donc l'EFFET — une écriture —, que tiennent
    // les cases grisées et le verrou ; le verrou seul s'y voit dès que les cases restent libres (mutations d'ordre deux,
    // HISTORIQUE.md, étape P1).
    await act(async () => { caseDe('Banque').click(); caseDe('Banque').click() })
    expect(faux.appelsRpc).toHaveLength(1)
    await liberer()
  })

  it('trois clics non plus : le verrou est posé avant le `try`', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    const liberer = retenirLEcriture()
    await act(async () => {
      caseDe('Banque').click()
      caseDe('Ventes', 'secretariat@exemple.fr').click()
      caseDe('Banque', 'secretariat@exemple.fr').click()
    })
    expect(faux.appelsRpc).toHaveLength(1)
    await liberer()
  })

  it('pendant l’écriture, la case montre la valeur demandée et toutes les cases attendent', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    const liberer = retenirLEcriture()
    await act(async () => { caseDe('Banque').click() })
    expect(caseDe('Banque').checked).toBe(true)
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').every((c) => c.disabled)).toBe(true)
    await liberer()
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').every((c) => !c.disabled)).toBe(true)
  })

  it('le verrou ne se relâche qu’APRÈS la relecture : pendant elle, les cases attendent et l’écran le dit', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    const libererLaLecture = retenir()
    await act(async () => { caseDe('Banque').click() })
    await laisserPasserUnTour()
    // L'écriture est revenue, la relecture non.
    expect(faux.appelsRpc).toHaveLength(1)
    expect(faux.lectures).toBe(2)
    expect(screen.getByRole('status').textContent).toBe('Relecture de la liste des accès : les cases attendent son retour.')
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').every((c) => c.disabled)).toBe(true)
    // La case garde la valeur demandée jusqu'au retour de la relecture : relâchée avant, elle reviendrait un instant à la
    // liste d'avant l'écriture, décochée, puis se recocherait.
    expect(caseDe('Banque').checked).toBe(true)
    // Un clic pendant la relecture ne part pas.
    await act(async () => { caseDe('Ventes', 'secretariat@exemple.fr').click() })
    expect(faux.appelsRpc).toHaveLength(1)

    await libererLaLecture()
    expect(screen.queryAllByRole('status')).toHaveLength(0)
    expect(caseDe('Banque').checked).toBe(true)
    await act(async () => { caseDe('Ventes', 'secretariat@exemple.fr').click() })
    expect(faux.appelsRpc).toHaveLength(2)
  })

  it('la relecture qui suit une création attend aussi : les cases sont grisées tant qu’elle n’est pas revenue', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email du client'), { target: { value: 'nouveau@exemple.fr' } })
      fireEvent.change(screen.getByLabelText('Mot de passe initial'), { target: { value: MOT_DE_PASSE } })
    })
    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    const liberer = retenir()
    await act(async () => { faux.resoudre?.({ data: { ok: true }, error: null }) })
    await laisserPasserUnTour()
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').every((c) => c.disabled)).toBe(true)
    await act(async () => { caseDe('Banque').click() })
    expect(faux.appelsRpc).toHaveLength(0)
    await liberer()
    expect(screen.getAllByRole<HTMLInputElement>('checkbox').every((c) => !c.disabled)).toBe(true)
  })

  it('un refus de la base se dit, avec le droit et la personne, et la relecture remet la case comme la base l’a gardée', async () => {
    faux.reponseRpc = { data: null, error: { message: 'Accès refusé à ce dossier.', code: '42501' } }
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { caseDe('Banque').click() })
    expect(screen.getByRole('alert').textContent)
      .toBe('Le droit « Banque » de client@exemple.fr n’a pas été enregistré : Accès refusé à ce dossier.')
    expect(caseDe('Banque').checked).toBe(false)
    expect(faux.lectures).toBe(2)
    // Le verrou s'est relâché : on peut réessayer.
    faux.reponseRpc = null
    await act(async () => { caseDe('Banque').click() })
    expect(faux.appelsRpc).toHaveLength(2)
    expect(caseDe('Banque').checked).toBe(true)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('un accès retiré entre-temps : le refus se dit, et la relecture le fait disparaître', async () => {
    monter()
    await screen.findByText('secretariat@exemple.fr')
    faux.lignes = faux.lignes.filter((l) => l.id !== 'm2')
    await act(async () => { caseDe('Banque', 'secretariat@exemple.fr').click() })
    expect(screen.getByRole('alert').textContent).toContain('Accès refusé à ce dossier.')
    expect(screen.queryAllByText('secretariat@exemple.fr')).toHaveLength(0)
  })

  it('une réponse qui ne porte pas le droit demandé ne passe pas pour un succès', async () => {
    faux.reponseRpc = { data: { id: 'm1', droit_ventes: true, droit_banque: false }, error: null }
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { caseDe('Banque').click() })
    expect(screen.getByRole('alert').textContent)
      .toBe('Le droit « Banque » de client@exemple.fr n’a pas été enregistré : la base n’a pas rendu le droit demandé ; la liste relue fait foi.')
  })

  it('aucune case tant que la liste n’est pas revenue', async () => {
    const liberer = retenir()
    monter()
    await laisserPasserUnTour()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    await liberer()
    expect(await screen.findAllByRole('checkbox')).toHaveLength(4)
  })

  it('aucune case sur une liste lue en partie : les droits lus se disent, le bandeau dit pourquoi', async () => {
    faux.compteAnnonce = 3
    monter()
    expect(await screen.findByText('client@exemple.fr')).toBeTruthy()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    const ligne = screen.getByText('client@exemple.fr').closest('tr')!
    expect(within(ligne).getAllByText(/^(Oui|Non)$/).map((e) => e.textContent)).toEqual(['Oui', 'Non'])
    expect(screen.getByText(/La liste des accès n'a pas pu être lue en entier \(2 ligne\(s\) lue\(s\) sur 3 annoncée\(s\)\)/)).toBeTruthy()
    expect(screen.getByText(/Les droits ne se changent pas depuis une liste incomplète/)).toBeTruthy()
    // La liste n'est pas vide pour autant : elle ne se dit pas « aucun accès ».
    expect(screen.queryAllByText(/Aucun accès client pour ce dossier/)).toHaveLength(0)
  })
})

// LE LIEN DE RÉINITIALISATION (décision du cabinet du 10/10/2026) : le même lien que « Mot de passe oublié », envoyé par
// le cabinet vers l'adresse d'un accès, sur un clic confirmé, sous un verrou. Tout se joue sur un double : aucun lien ne
// part vers personne.
const LIEN = 'Envoyer un lien de réinitialisation'

function retenirLeLien(): () => Promise<void> {
  let ouvrir = () => {}
  faux.porteLien = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux.porteLien = null
    await act(async () => { ouvrir() })
  }
}

const boutonLienDe = (personne = 'client@exemple.fr') => {
  const ligne = screen.getByText(personne).closest('tr')
  if (!ligne) throw new Error('ligne de l’accès introuvable')
  return within(ligne).getByRole<HTMLButtonElement>('button', { name: /lien/ })
}

describe('AccesTab — envoyer un lien de réinitialisation au client', () => {
  beforeEach(() => {
    faux.lignes = [
      acces({ id: 'm1', user_id: 'u1', email: 'client@exemple.fr' }),
      acces({ id: 'm2', user_id: 'u2', email: 'secretariat@exemple.fr', created_at: '2026-10-02T08:00:00Z' }),
    ]
  })

  it('un bouton par accès qui a une adresse, et aucun pour un accès sans adresse', async () => {
    faux.lignes = [...faux.lignes, acces({ id: 'm3', user_id: 'u-sans-adresse', created_at: '2026-10-03T08:00:00Z' })]
    monter()
    await screen.findByText('client@exemple.fr')
    expect(screen.getAllByRole('button', { name: LIEN })).toHaveLength(2)
    const sansAdresse = screen.getByText('u-sans-adresse').closest('tr')!
    expect(within(sansAdresse).queryAllByRole('button', { name: LIEN })).toHaveLength(0)
    // Rien ne part au chargement.
    expect(faux.appelsLien).toHaveLength(0)
  })

  it('la confirmation NOMME l’adresse ; le lien part vers elle avec l’adresse de retour du module, et le succès le dit', async () => {
    const questions: string[] = []
    window.confirm = (m?: string) => { questions.push(m ?? ''); return true }
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { boutonLienDe('secretariat@exemple.fr').click() })

    expect(questions).toEqual([
      'Envoyer à secretariat@exemple.fr un lien pour choisir un nouveau mot de passe ? '
      + "Le mot de passe actuel reste valable tant que le client n'en a pas choisi un autre par ce lien.",
    ])
    // L'adresse de retour écrite en clair : une constante changée dans le module se verrait ici aussi.
    expect(faux.appelsLien).toEqual([{ adresse: 'secretariat@exemple.fr', options: { redirectTo: 'https://compta.jdarnis.fr/' } }])
    expect(screen.getByRole('status').textContent)
      .toBe("Un lien de réinitialisation est parti vers secretariat@exemple.fr. Il ne sert qu'une fois.")
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    // Rien n'est écrit en base, et rien n'est relu.
    expect(faux.appelsRpc).toHaveLength(0)
    expect(faux.suppressions).toBe(0)
    expect(faux.lectures).toBe(1)
  })

  it('la confirmation refusée n’envoie rien et ne dit rien', async () => {
    window.confirm = () => false
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { boutonLienDe().click() })
    expect(faux.appelsLien).toHaveLength(0)
    expect(screen.queryAllByRole('status')).toHaveLength(0)
    // Le refus ne laisse aucun verrou derrière lui : le clic suivant, confirmé, part.
    window.confirm = () => true
    await act(async () => { boutonLienDe().click() })
    expect(faux.appelsLien).toHaveLength(1)
  })

  it('deux clics du même rendu n’envoient qu’un lien', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    const liberer = retenirLeLien()
    await act(async () => { boutonLienDe().click(); boutonLienDe().click() })
    expect(faux.appelsLien).toHaveLength(1)
    await liberer()
  })

  it('trois clics non plus : le verrou est posé avant le `try`', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    const liberer = retenirLeLien()
    await act(async () => {
      boutonLienDe().click()
      boutonLienDe('secretariat@exemple.fr').click()
      boutonLienDe().click()
    })
    expect(faux.appelsLien).toHaveLength(1)
    await liberer()
  })

  it('pendant l’envoi, le bouton le dit et tous les boutons de lien attendent ; après, ils reviennent', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    const liberer = retenirLeLien()
    await act(async () => { boutonLienDe().click() })
    expect(boutonLienDe().textContent).toBe('Envoi du lien…')
    expect(boutonLienDe().disabled).toBe(true)
    expect(boutonLienDe('secretariat@exemple.fr').disabled).toBe(true)
    await liberer()
    expect(boutonLienDe().textContent).toBe(LIEN)
    expect(boutonLienDe().disabled).toBe(false)
    expect(boutonLienDe('secretariat@exemple.fr').disabled).toBe(false)
  })

  it('un nouvel envoi efface l’avis du précédent : rien ne dit « parti » d’un lien encore en vol', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { boutonLienDe().click() })
    expect(screen.getByRole('status').textContent).toContain('client@exemple.fr')
    const liberer = retenirLeLien()
    await act(async () => { boutonLienDe('secretariat@exemple.fr').click() })
    expect(screen.queryAllByRole('status')).toHaveLength(0)
    await liberer()
    expect(screen.getByRole('status').textContent).toContain('secretariat@exemple.fr')
  })

  it('le refus pour trop de demandes se dit en français, avec l’adresse, et le verrou se relâche', async () => {
    faux.erreurLien = { name: 'AuthApiError', message: 'For security purposes, you can only request this after 42 seconds.', status: 429, code: 'over_email_send_rate_limit' }
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { boutonLienDe().click() })
    expect(screen.getByRole('alert').textContent).toBe(
      "Trop de demandes rapprochées : le service d'authentification n'a pas envoyé de nouveau lien vers client@exemple.fr. "
      + "Un lien vient peut-être d'y partir ; sinon, attends quelques minutes, puis réessaie.",
    )
    expect(screen.queryAllByRole('status')).toHaveLength(0)

    faux.erreurLien = null
    await act(async () => { boutonLienDe().click() })
    expect(faux.appelsLien).toHaveLength(2)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toContain('client@exemple.fr')
  })

  it('une autre erreur du service se dit par son message', async () => {
    faux.erreurLien = { name: 'AuthRetryableFetchError', message: 'Error sending recovery email', status: 500 }
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { boutonLienDe().click() })
    expect(screen.getByRole('alert').textContent).toBe("Le lien n'a pas pu partir vers client@exemple.fr : Error sending recovery email")
  })

  it('une exception se dit aussi, et relâche le verrou', async () => {
    faux.exceptionLien = new TypeError('réseau coupé')
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => { boutonLienDe().click() })
    expect(screen.getByRole('alert').textContent).toBe("Le lien n'a pas pu partir vers client@exemple.fr : réseau coupé")
    faux.exceptionLien = null
    await act(async () => { boutonLienDe().click() })
    expect(faux.appelsLien).toHaveLength(2)
  })

  it('aucun bouton tant que la liste n’est pas revenue', async () => {
    const liberer = retenir()
    monter()
    await laisserPasserUnTour()
    expect(screen.queryAllByRole('button', { name: LIEN })).toHaveLength(0)
    await liberer()
    expect(await screen.findAllByRole('button', { name: LIEN })).toHaveLength(2)
  })

  it('aucun bouton sur une liste lue en partie', async () => {
    faux.compteAnnonce = 3
    monter()
    expect(await screen.findByText('client@exemple.fr')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: LIEN })).toHaveLength(0)
  })

  it('aucun bouton sur une liste illisible', async () => {
    faux.erreurLecture = { message: 'JWT expired' }
    monter()
    expect(await screen.findByText(/JWT expired/)).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: LIEN })).toHaveLength(0)
  })

  it('pendant une relecture, les boutons de lien attendent', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    const liberer = retenir()
    await act(async () => { caseDe('Banque').click() })
    await laisserPasserUnTour()
    expect(boutonLienDe().disabled).toBe(true)
    await liberer()
    expect(boutonLienDe().disabled).toBe(false)
  })
})

// CE QUE L'ÉCRAN DIT D'UN ACCÈS CRÉÉ (décision du cabinet du 10/10/2026 : un compte qui existe déjà garde son mot de passe).
// La fonction dit lequel des deux cas s'est produit ; l'écran le dit au cabinet, faute de quoi il communiquerait au client
// un mot de passe qui n'a jamais été posé.
describe('AccesTab — ce que l’écran dit d’un accès créé', () => {
  async function creer(adresse: string, reponse: unknown) {
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email du client'), { target: { value: adresse } })
      fireEvent.change(screen.getByLabelText('Mot de passe initial'), { target: { value: MOT_DE_PASSE } })
    })
    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    // L'accès créé, tel que la relecture le trouvera.
    faux.lignes = [...faux.lignes, acces({ id: 'm9', user_id: 'u9', email: adresse, created_at: '2026-10-09T08:00:00Z' })]
    await act(async () => { faux.resoudre?.(reponse) })
    await laisserPasserUnTour()
  }
  const avis = () => screen.queryAllByRole('status').map((e) => e.textContent ?? '')

  it('un compte créé : l’avis nomme l’adresse, et le mot de passe saisi se communique', async () => {
    await creer('nouveau@exemple.fr', { data: { ok: true, compte: 'cree' }, error: null })
    expect(avis()).toEqual(["L'accès de nouveau@exemple.fr est créé : communique-lui le mot de passe initial que tu as saisi."])
  })

  it('un compte existant : il garde son mot de passe, celui saisi ne se communique pas, et le bouton du lien est là', async () => {
    await creer('ancien@exemple.fr', { data: { ok: true, compte: 'existant' }, error: null })
    const [texte, ...autres] = avis()
    expect(autres).toEqual([])
    expect(texte).toContain("L'accès de ancien@exemple.fr est créé.")
    expect(texte).toContain('le client garde son mot de passe actuel')
    expect(texte).toContain("celui saisi ici n'a pas été posé — ne le lui communique pas")
    expect(texte).not.toContain('communique-lui')
    // Le bouton que l'avis nomme existe, sur la ligne de l'accès relu.
    expect(texte).toContain('« Envoyer un lien de réinitialisation »')
    const ligne = screen.getByText('ancien@exemple.fr').closest('tr')
    if (!ligne) throw new Error('ligne de l’accès créé introuvable')
    expect(within(ligne).getByRole('button', { name: 'Envoyer un lien de réinitialisation' })).toBeTruthy()
  })

  it('une fonction d’avant le 10/10/2026, sans le champ : l’avis d’un compte créé — elle avait posé le mot de passe', async () => {
    await creer('nouveau@exemple.fr', { data: { ok: true }, error: null })
    expect(avis()).toEqual(["L'accès de nouveau@exemple.fr est créé : communique-lui le mot de passe initial que tu as saisi."])
  })

  it('une réponse qui ne dit rien de sûr : aucune promesse sur le mot de passe', async () => {
    await creer('nouveau@exemple.fr', { data: { ok: true, compte: 'repris' }, error: null })
    const [texte] = avis()
    expect(texte).toContain("le mot de passe saisi n'est peut-être pas le sien")
    expect(texte).not.toContain('communique-lui')
  })

  it('un refus de la fonction se dit, sans avis de création', async () => {
    const refus = "Un compte existe déjà avec cet e-mail, mais il n'est rattaché à aucun dossier ou membre de ce cabinet."
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email du client'), { target: { value: 'ailleurs@exemple.fr' } })
      fireEvent.change(screen.getByLabelText('Mot de passe initial'), { target: { value: MOT_DE_PASSE } })
    })
    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    await act(async () => { faux.resoudre?.({ data: { error: refus }, error: null }) })
    expect(screen.getByText(refus)).toBeTruthy()
    expect(avis()).toEqual([])
  })

  it('un nouvel envoi efface l’avis du précédent : rien ne dit « créé » d’un accès encore en vol', async () => {
    await creer('ancien@exemple.fr', { data: { ok: true, compte: 'existant' }, error: null })
    expect(avis()).toHaveLength(1)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email du client'), { target: { value: 'nouveau@exemple.fr' } })
      fireEvent.change(screen.getByLabelText('Mot de passe initial'), { target: { value: MOT_DE_PASSE } })
    })
    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    expect(faux.appels).toHaveLength(2)
    expect(avis()).toEqual([])
    await act(async () => { faux.resoudre?.({ data: { ok: true, compte: 'cree' }, error: null }) })
    await laisserPasserUnTour()
    expect(avis()).toEqual(["L'accès de nouveau@exemple.fr est créé : communique-lui le mot de passe initial que tu as saisi."])
  })

  it('le formulaire le dit avant le clic : le mot de passe saisi ne sert qu’à un compte neuf', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    expect(screen.getByText(/Il ne sert qu'à un compte neuf : un client qui a déjà un compte garde le sien\./)).toBeTruthy()
  })
})

describe('AccesTab — ce que la phrase promet', () => {
  it('dit ce qu’un accès donne aujourd’hui, et ce qu’une case n’y change pas encore', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    expect(screen.getByText(CE_QUE_DONNE_UN_ACCES)).toBeTruthy()
    expect(screen.getByText(CE_QUE_DISENT_LES_CASES)).toBeTruthy()
    // L'ancienne phrase promettait ce que le code ne tenait pas : la simulation du client montre des montants.
    expect(screen.queryAllByText(/aucun accès aux montants/)).toHaveLength(0)
  })
})

// « Copier » l'adresse de collecte affiche « Copié ✓ » deux secondes. Le minuteur ne partait pas avec l'écran : la
// suite démonte chaque écran à la fin de son test, et un rappel resté en vol tombait, sous la charge, sur un
// environnement déjà détruit — une erreur non gérée qui faisait échouer la suite au hasard. Et un presse-papiers
// refusé partait lui aussi en erreur non gérée, le clic ne disant rien.
describe('AccesTab — « Copier » l’adresse de collecte', () => {
  let ecrire: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ecrire = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: ecrire } })
    // Seuls les minuteurs sont simulés : la lecture du faux client passe par des promesses, que rien ne retient.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('le minuteur du « Copié ✓ » part avec l’écran', async () => {
    const { unmount } = monter()
    await act(async () => { screen.getByRole('button', { name: 'Copier' }).click() })

    expect(ecrire).toHaveBeenCalledWith('abc123@precompta.jdarnis.fr')
    expect(screen.getByRole('button', { name: 'Copié ✓' })).toBeTruthy()
    // Le garde voit bien le minuteur armé : sans cette ligne, « zéro après le démontage » passerait aussi pour un écran
    // qui n'en arme aucun.
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('le « Copié ✓ » s’efface au bout de deux secondes', async () => {
    monter()
    await act(async () => { screen.getByRole('button', { name: 'Copier' }).click() })
    expect(screen.getByRole('button', { name: 'Copié ✓' })).toBeTruthy()

    await act(async () => { vi.advanceTimersByTime(1999) })
    expect(screen.getByRole('button', { name: 'Copié ✓' })).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('button', { name: 'Copier' })).toBeTruthy()
  })

  it('deux copies rapprochées ne laissent qu’un minuteur, qui part avec l’écran', async () => {
    const { unmount } = monter()
    await act(async () => { screen.getByRole('button', { name: 'Copier' }).click() })
    await act(async () => { vi.advanceTimersByTime(1000) })
    await act(async () => { screen.getByRole('button', { name: 'Copié ✓' }).click() })
    // Le premier minuteur, laissé armé, effacerait le « Copié ✓ » du second une seconde trop tôt, et survivrait au
    // démontage : seul le dernier est gardé.
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(screen.getByRole('button', { name: 'Copié ✓' })).toBeTruthy()

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('une copie revenue après le démontage n’arme aucun minuteur', async () => {
    let liberer = () => {}
    ecrire.mockImplementation(() => new Promise<void>((resolve) => { liberer = resolve }))
    const { unmount } = monter()
    await act(async () => { screen.getByRole('button', { name: 'Copier' }).click() })

    unmount()
    await act(async () => { liberer() })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('un presse-papiers refusé se dit, sans « Copié ✓ » ni minuteur', async () => {
    ecrire.mockRejectedValue(new DOMException('Refusé', 'NotAllowedError'))
    monter()
    await act(async () => { screen.getByRole('button', { name: 'Copier' }).click() })

    expect(screen.getByText(/Le navigateur a refusé la copie/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copié ✓' })).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

// LA RÈGLE DES MOTS DE PASSE DU PROJET (défaut 23.5, 10/10/2026). Le service d'authentification refusait un mot de passe
// que la règle posée au tableau de bord n'admet pas, et `create-client-access` le disait « Un compte existe déjà… ».
// L'écran dit désormais la règle avant le clic, refuse avant tout appel ce qui ne la suit pas, et montre tel quel le
// refus que la fonction traduit (une règle réglée autrement au tableau de bord que son reflet).
describe('AccesTab — la règle des mots de passe du projet', () => {
  async function saisir(motDePasse: string) {
    monter()
    await screen.findByText('client@exemple.fr')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email du client'), { target: { value: 'nouveau@exemple.fr' } })
      fireEvent.change(screen.getByLabelText('Mot de passe initial'), { target: { value: motDePasse } })
    })
  }

  it('dit la règle sous le champ, avant le clic — et le navigateur n’y remplit pas le mot de passe du cabinet', async () => {
    monter()
    await screen.findByText('client@exemple.fr')
    const champ = screen.getByLabelText<HTMLInputElement>('Mot de passe initial')
    const regle = screen.getByText(REGLE_DU_MOT_DE_PASSE)
    expect(champ.getAttribute('aria-describedby')).toBe(regle.id)
    expect(champ.autocomplete).toBe('new-password')
    expect(champ.minLength).toBe(10)
  })

  it('un mot de passe qui ne suit pas la règle ne part pas : aucun appel, et l’écran dit ce qui manque', async () => {
    await saisir('1234567890')
    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    expect(faux.appels).toEqual([])
    expect(screen.getByText('Ce mot de passe ne suit pas la règle du projet : il doit contenir une minuscule, une majuscule et un symbole.')).toBeTruthy()
    // Le refus ne prend pas le verrou : le mot de passe corrigé part aussitôt.
    await act(async () => { fireEvent.change(screen.getByLabelText('Mot de passe initial'), { target: { value: MOT_DE_PASSE } }) })
    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    expect(faux.appels).toHaveLength(1)
    expect(screen.queryAllByText(/ne suit pas la règle du projet/)).toHaveLength(0)
  })

  it('un refus de la règle efface l’avis de la création précédente : rien ne dit « créé » à côté de lui', async () => {
    await saisir(MOT_DE_PASSE)
    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    faux.lignes = [...faux.lignes, acces({ id: 'm9', user_id: 'u9', email: 'nouveau@exemple.fr', created_at: '2026-10-09T08:00:00Z' })]
    await act(async () => { faux.resoudre?.({ data: { ok: true, compte: 'cree' }, error: null }) })
    await laisserPasserUnTour()
    expect(screen.queryAllByRole('status').map((e) => e.textContent ?? '').filter((t) => t.includes('est créé'))).toHaveLength(1)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email du client'), { target: { value: 'autre@exemple.fr' } })
      fireEvent.change(screen.getByLabelText('Mot de passe initial'), { target: { value: 'motdepassesimple' } })
    })
    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    expect(faux.appels).toHaveLength(1)
    expect(screen.getByText('Ce mot de passe ne suit pas la règle du projet : il doit contenir une majuscule, un chiffre et un symbole.')).toBeTruthy()
    expect(screen.queryAllByRole('status').map((e) => e.textContent ?? '').filter((t) => t.includes('est créé'))).toEqual([])
  })

  it('le refus du service, traduit par la fonction (400), se dit tel quel, sans avis de création', async () => {
    const refus = refusDuMotDePasse(new AuthWeakPasswordError('Password should be at least 12 characters.', 422, ['length']))
    expect(refus).toMatch(/il est trop court\.$/)
    await saisir(MOT_DE_PASSE)
    await act(async () => { screen.getByRole('button', { name: /Créer l'accès/ }).click() })
    // La réponse réelle d'un statut non-2xx : supabase-js ne remplit pas `data`, le corps se lit sur le contexte.
    const reponse = new Response(JSON.stringify({ error: refus }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    await act(async () => { faux.resoudre?.({ data: null, error: new FunctionsHttpError(reponse) }) })
    expect(await screen.findByText(refus as string)).toBeTruthy()
    expect(screen.queryAllByText(/Un compte existe déjà/)).toHaveLength(0)
    expect(screen.queryAllByRole('status').map((e) => e.textContent ?? '').filter((t) => t.includes('est créé'))).toEqual([])
  })
})
