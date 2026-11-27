import { act, fireEvent, render, screen } from '@testing-library/react'
import { AuthWeakPasswordError, FunctionsHttpError } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REGLE_DU_MOT_DE_PASSE, refusDuMotDePasse } from '../lib/recuperationMotDePasse'
import SuperAdminPage from './SuperAdminPage'

// « NOUVEAU CABINET » NE SE PROTÉGEAIT QUE PAR UN ÉTAT (09/10/2026).
//
// `disabled={enregistrement}` ne prend effet qu'au rendu suivant : deux soumissions du même rendu appelaient deux fois
// `create-cabinet`. Chaque appel crée SON cabinet, puis son premier comptable en chef ; le second bute sur l'adresse que le
// premier vient d'inscrire, retire le cabinet qu'il venait de créer (la compensation de la fonction) et répond « Un compte
// existe déjà avec cet e-mail » — une erreur affichée sur une création réussie, et, si la compensation échoue, un cabinet
// fantôme dans le parc.
//
// LA COMPENSATION GARDE SA RAISON D'ÊTRE une fois le verrou posé : elle existe pour une adresse DÉJÀ inscrite ailleurs,
// saisie une seule fois, ou pour deux super-administrateurs qui créeraient le même cabinet depuis deux postes — deux cas
// qu'aucun verrou d'écran ne voit. Le verrou ne retire que le chemin du double envoi.
//
// Le cas à TROIS envois est le seul à distinguer un verrou posé dans le `try`.
const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; body: unknown }[],
  // La réponse de la fonction attend `porte` quand le test la pose : la fenêtre pendant laquelle un second envoi arrive.
  porte: null as Promise<void> | null,
  refus: null as string | null,
  // L'erreur que supabase-js rend sur un statut non-2xx (`FunctionsHttpError`, le corps sur son contexte), quand elle est posée.
  erreur: null as unknown,
  // Le parc que lisent les tests des plafonds (OPT1-Q3) : vide ailleurs.
  cabinets: [] as Record<string, unknown>[],
  // Ce que rend `plafonds_de_l_assistant()` ; `refusPlafonds` posé, la fonction refuse.
  plafonds: [] as Record<string, unknown>[],
  refusPlafonds: null as { message: string; code: string } | null,
  rpcs: [] as string[],
  // Le journal de consommation (ASSIST-Q1) : le drapeau, joué par un accesseur ; ce que rend `consommation_de_l_assistant`, et
  // les arguments qu'elle a reçus ; `refusConsommations` posé, elle refuse.
  tenue: false,
  consommations: [] as Record<string, unknown>[],
  refusConsommations: null as { message: string; code: string } | null,
  argumentsRpc: [] as unknown[],
  // Les lignes `agent_conversations` que l'assistant recopie (le compteur d'hier).
  conversations: [] as Record<string, unknown>[],
}))

vi.mock('../lib/consommationDeLAssistant', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../lib/consommationDeLAssistant')>()
  return { ...reel, get CONSOMMATION_TENUE_PAR_LA_FONCTION() { return faux.tenue } }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    // Les lectures du parc — cabinets, dossiers, membres, accès, usage de l'assistant — rendent un parc vide, lu en
    // entier : rien de ce que ce test garde n'en dépend.
    from: (table: string) => {
      const lignes = table === 'cabinets' ? faux.cabinets : table === 'agent_conversations' ? faux.conversations : []
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        range: () => chaine,
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) =>
          Promise.resolve({ data: lignes, error: null, count: lignes.length }).then(suite),
      })
      return chaine
    },
    // Les plafonds de l'assistant (OPT1-Q3, en production depuis le 20/11/2026) : une fonction qui rend une table, paginée.
    rpc: (nom: string, args?: unknown) => {
      faux.rpcs.push(nom)
      faux.argumentsRpc.push(args)
      const rendu = nom === 'plafonds_de_l_assistant'
        ? (faux.refusPlafonds ? { data: null, error: faux.refusPlafonds, count: null } : { data: faux.plafonds, error: null, count: faux.plafonds.length })
        : nom === 'consommation_de_l_assistant'
          ? (faux.refusConsommations ? { data: null, error: faux.refusConsommations, count: null } : { data: faux.consommations, error: null, count: faux.consommations.length })
          : { data: null, error: { message: `fonction inconnue : ${nom}`, code: 'PGRST202' }, count: null }
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        order: () => chaine,
        range: () => chaine,
        then: (suite: (r: unknown) => unknown) => Promise.resolve(rendu).then(suite),
      })
      return chaine
    },
    functions: {
      invoke: async (nom: string, options: { body: unknown }) => {
        faux.appels.push({ nom, body: options.body })
        await faux.porte
        if (faux.erreur) return { data: null, error: faux.erreur }
        return faux.refus ? { data: { error: faux.refus }, error: null } : { data: { ok: true }, error: null }
      },
    },
  },
}))

// La restauration vit sur cet écran et a ses propres tests ; elle ne lit ni n'écrit rien de ce qu'on garde ici.
vi.mock('./RestaurationCard', () => ({ default: () => null }))

beforeEach(() => {
  faux.appels = []
  faux.porte = null
  faux.refus = null
  faux.erreur = null
  faux.cabinets = []
  faux.plafonds = []
  faux.refusPlafonds = null
  faux.rpcs = []
  faux.tenue = false
  faux.consommations = []
  faux.refusConsommations = null
  faux.argumentsRpc = []
  faux.conversations = []
})

// Une porte laissée par un test qui échoue ne doit pas faire échouer les suivants.
afterEach(() => { faux.porte = null })

function retenirLaReponse(): () => Promise<void> {
  let ouvrir = () => {}
  faux.porte = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux.porte = null
    await act(async () => { ouvrir() })
  }
}

const creations = () => faux.appels.filter((a) => a.nom === 'create-cabinet')

// Un mot de passe qui suit la règle du projet (lib/recuperationMotDePasse.ts) : sans elle, le formulaire refuse avant tout appel.
const MOT_DE_PASSE = 'Mot-de-passe-fictif-1'

// Les champs requis sont remplis : jsdom bloque la soumission d'un formulaire dont un champ requis est vide.
async function ouvrirLeFormulaire() {
  await act(async () => { render(<SuperAdminPage />) })
  await act(async () => { screen.getByRole('button', { name: '+ Nouveau cabinet' }).click() })
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Nom du cabinet'), { target: { value: 'Cabinet Fictif' } })
    fireEvent.change(screen.getByLabelText('Email du comptable en chef'), { target: { value: 'chef@cabinet-fictif.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: MOT_DE_PASSE } })
  })
  const bouton = screen.getByRole('button', { name: 'Créer le cabinet' }) as HTMLButtonElement
  return { bouton, formulaire: bouton.closest('form')! }
}

describe('SuperAdminPage — le verrou de la création d’un cabinet', () => {
  it('ne crée le cabinet qu’une fois quand le formulaire est soumis deux fois dans le même rendu', async () => {
    const { bouton } = await ouvrirLeFormulaire()
    const liberer = retenirLaReponse()

    await act(async () => { bouton.click(); bouton.click() })

    expect(creations()).toHaveLength(1)
    expect(creations()[0].body).toEqual({ nom: 'Cabinet Fictif', email: 'chef@cabinet-fictif.fr', password: MOT_DE_PASSE })
    expect(bouton.disabled).toBe(true)
    expect(bouton.textContent).toBe('Création…')
    await liberer()
    expect(screen.queryByRole('heading', { name: 'Nouveau cabinet' })).toBeNull()
  })

  it('trois soumissions du formulaire — « Entrée » dans un champ — ne le créent qu’une fois', async () => {
    const { formulaire } = await ouvrirLeFormulaire()
    const liberer = retenirLaReponse()

    await act(async () => { for (let i = 0; i < 3; i++) fireEvent.submit(formulaire) })

    expect(creations()).toHaveLength(1)
    await liberer()
  })

  it('relâche le verrou sur un refus de la fonction, et le dit', async () => {
    faux.refus = 'Un compte existe déjà avec cet e-mail — utilise une autre adresse pour le premier comptable en chef de ce cabinet.'
    const { bouton } = await ouvrirLeFormulaire()

    await act(async () => { bouton.click() })
    expect(screen.getByText(/Un compte existe déjà avec cet e-mail/)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Créer le cabinet' }).click() })

    expect(creations()).toHaveLength(2)
  })
})

// LA RÈGLE DES MOTS DE PASSE DU PROJET (défaut 23.5, 10/10/2026). `create-cabinet` prenait le refus d'un mot de passe par
// le service pour une adresse déjà inscrite — après avoir écrit le cabinet, qu'il retire. L'écran dit la règle avant le
// clic, refuse avant tout appel ce qui ne la suit pas (aucun cabinet écrit), et montre tel quel le refus que la fonction
// traduit.
describe('SuperAdminPage — la règle des mots de passe du projet', () => {
  async function ouvrir(motDePasse: string) {
    await act(async () => { render(<SuperAdminPage />) })
    await act(async () => { screen.getByRole('button', { name: '+ Nouveau cabinet' }).click() })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Nom du cabinet'), { target: { value: 'Cabinet Fictif' } })
      fireEvent.change(screen.getByLabelText('Email du comptable en chef'), { target: { value: 'chef@cabinet-fictif.fr' } })
      fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: motDePasse } })
    })
  }

  it('dit la règle sous le champ, avant le clic — et le navigateur n’y remplit pas le mot de passe du super-administrateur', async () => {
    await ouvrir('')
    const champ = screen.getByLabelText<HTMLInputElement>('Mot de passe')
    const regle = screen.getByText(REGLE_DU_MOT_DE_PASSE)
    expect(champ.getAttribute('aria-describedby')).toBe(regle.id)
    expect(champ.autocomplete).toBe('new-password')
    expect(champ.minLength).toBe(10)
  })

  it('un mot de passe qui ne suit pas la règle ne part pas : aucun cabinet écrit, et l’écran dit ce qui manque', async () => {
    await ouvrir('Motdepasse12')
    await act(async () => { screen.getByRole('button', { name: 'Créer le cabinet' }).click() })
    expect(creations()).toEqual([])
    expect(screen.getByText('Ce mot de passe ne suit pas la règle du projet : il doit contenir un symbole.')).toBeTruthy()
    await act(async () => { fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: MOT_DE_PASSE } }) })
    await act(async () => { screen.getByRole('button', { name: 'Créer le cabinet' }).click() })
    expect(creations()).toHaveLength(1)
  })

  // 23-Q5 : le maximum de bcrypt, 72 OCTETS (la fonction le rendait en 500 et en anglais, après avoir écrit le cabinet).
  // Trente-neuf caractères pour soixante-quatorze octets : l'écran dit la limite sous le champ, puis refuse avant tout appel.
  it('un mot de passe de plus de 72 octets ne part pas, même court en caractères : la limite est dite avant le clic, puis le refus', async () => {
    await ouvrir(`${'é'.repeat(35)}Aa1!`)
    expect(screen.getByText(REGLE_DU_MOT_DE_PASSE).textContent).toContain('Au plus 72 octets')
    await act(async () => { screen.getByRole('button', { name: 'Créer le cabinet' }).click() })
    expect(creations()).toEqual([])
    expect(screen.getByText(
      'Ce mot de passe ne suit pas la règle du projet : il doit faire au plus 72 octets (une lettre accentuée ou un symbole comme « € » compte pour plusieurs octets, et celui-ci en fait 74).',
    )).toBeTruthy()
    // Soixante-douze octets tout juste : il part.
    await act(async () => { fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: `${'é'.repeat(34)}Aa1!` } }) })
    await act(async () => { screen.getByRole('button', { name: 'Créer le cabinet' }).click() })
    expect(creations()).toHaveLength(1)
  })

  it('le refus du service, traduit par la fonction (400), se dit tel quel, et le formulaire reste ouvert', async () => {
    const refus = refusDuMotDePasse(new AuthWeakPasswordError('Password should contain at least one character of each: …', 422, ['characters']))
    expect(refus).toMatch(/il lui manque une sorte de caractères/)
    faux.erreur = new FunctionsHttpError(new Response(JSON.stringify({ error: refus }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    await ouvrir(MOT_DE_PASSE)
    await act(async () => { screen.getByRole('button', { name: 'Créer le cabinet' }).click() })
    expect(await screen.findByText(refus as string)).toBeTruthy()
    expect(screen.queryAllByText(/Un compte existe déjà/)).toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'Nouveau cabinet' })).toBeTruthy()
  })
})

// LES PLAFONDS DE L'ASSISTANT HORS DE LA LECTURE DU CLIENT (OPT1-Q3, en production depuis le 20/11/2026). Les rôles de l'API ne
// lisent plus les deux colonnes des plafonds dans `cabinets` : l'écran les lit par `plafonds_de_l_assistant()`. Un cabinet que
// la fonction ne rend pas, ou rend illisible, se dit « Illisibles » et n'offre pas « Plafond IA » — un formulaire prérempli de
// vide effacerait le plafond.
describe('SuperAdminPage — les plafonds de l’assistant, lus par la fonction', () => {
  const cabinet = (id: string, nom: string) => ({ id, nom, couleur_primaire: null, logo_storage_path: null, created_at: '2026-11-01T10:00:00Z' })
  // La ligne du parc : le nom d'un cabinet paraît aussi dans la carte de ses modules (OPT4), sans « Exporter ».
  const ligne = (nom: string) => {
    const lignes = screen.getAllByText(nom).map((e) => e.closest('tr')).filter((tr) => tr?.textContent?.includes('Exporter'))
    expect(lignes).toHaveLength(1)
    return lignes[0] as HTMLElement
  }
  const boutons = (nom: string) => [...ligne(nom).querySelectorAll('button')].map((b) => b.textContent)

  it('lit les plafonds par la fonction ; un cabinet rendu offre « Plafond IA », un cabinet absent ou illisible non', async () => {
    faux.cabinets = [cabinet('a', 'Cabinet Alpha'), cabinet('b', 'Cabinet Bêta'), cabinet('c', 'Cabinet Gamma')]
    faux.plafonds = [
      { cabinet_id: 'a', limite_ia_alerte_usd: '10', limite_ia_blocage_usd: 20 },
      { cabinet_id: 'c', limite_ia_alerte_usd: 'beaucoup', limite_ia_blocage_usd: null },
    ]
    await act(async () => { render(<SuperAdminPage />) })

    expect(faux.rpcs).toContain('plafonds_de_l_assistant')
    expect(ligne('Cabinet Alpha').textContent).toMatch(/alerte .*10.*blocage .*20/)
    expect(boutons('Cabinet Alpha')).toContain('Plafond IA')
    for (const nom of ['Cabinet Bêta', 'Cabinet Gamma']) {
      expect(ligne(nom).textContent).toContain('Illisibles')
      expect(boutons(nom)).not.toContain('Plafond IA')
    }
  })

  it('la fonction refusée : chaque cabinet « Illisibles », aucun « Plafond IA »', async () => {
    faux.cabinets = [cabinet('a', 'Cabinet Alpha')]
    faux.refusPlafonds = { message: 'permission denied for function plafonds_de_l_assistant', code: '42501' }
    await act(async () => { render(<SuperAdminPage />) })

    expect(ligne('Cabinet Alpha').textContent).toContain('Illisibles')
    expect(boutons('Cabinet Alpha')).not.toContain('Plafond IA')
  })
})

// LE JOURNAL DE CONSOMMATION DE L'ASSISTANT (ASSIST-Q1, `CONSOMMATION_TENUE_PAR_LA_FONCTION`). Drapeau baissé, l'écran somme les
// tokens que l'assistant recopie dans `agent_conversations`, comme hier, et n'appelle pas la lecture du journal ; levé, il lit les
// sommes du journal par `consommation_de_l_assistant`, depuis le premier instant du mois UTC — la frontière du plafond —, et
// plus aucune ligne recopiée ; une somme illisible, ou la lecture refusée, se disent par le bandeau, jamais un zéro deviné.
describe('SuperAdminPage — la consommation de l’assistant', () => {
  const cabinet = (id: string, nom: string) => ({ id, nom, couleur_primaire: null, logo_storage_path: null, created_at: '2026-11-01T10:00:00Z' })
  const ligne = (nom: string) => screen.getAllByText(nom).map((e) => e.closest('tr')).find((tr) => tr?.textContent?.includes('Exporter')) as HTMLElement
  beforeEach(() => {
    faux.cabinets = [cabinet('a', 'Cabinet Alpha')]
    faux.plafonds = [{ cabinet_id: 'a', limite_ia_alerte_usd: null, limite_ia_blocage_usd: 5 }]
  })

  it('drapeau baissé : les lignes que l’assistant recopie, et pas la lecture du journal', async () => {
    faux.conversations = [{ dossier_id: 'd', tokens_entree: 1000, tokens_sortie: 2000, created_at: new Date().toISOString(), id: '1' }]
    await act(async () => { render(<SuperAdminPage />) })
    expect(faux.rpcs).not.toContain('consommation_de_l_assistant')
  })

  it('drapeau levé : les sommes du journal, depuis toujours et depuis le mois UTC, que le plafond compare', async () => {
    faux.tenue = true
    faux.conversations = [{ dossier_id: 'd', tokens_entree: 9_000_000, tokens_sortie: 9_000_000, created_at: new Date().toISOString(), id: '1' }]
    faux.consommations = [{ cabinet_id: 'a', tokens_entree: '400000', tokens_sortie: 300000, tokens_entree_depuis: 100000, tokens_sortie_depuis: 200000 }]
    await act(async () => { render(<SuperAdminPage />) })

    const i = faux.rpcs.indexOf('consommation_de_l_assistant')
    expect(i).toBeGreaterThanOrEqual(0)
    const maintenant = new Date()
    expect(faux.argumentsRpc[i]).toEqual({ p_depuis: new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1)).toISOString() })
    const texte = ligne('Cabinet Alpha').textContent ?? ''
    // Depuis toujours : 400 000 / 300 000 tokens ; le mois : 0,30 $ + 3,00 $ = 3,30 $, sous le blocage de 5 $.
    expect(texte.replace(/\s/g, ' ')).toContain('400 000 / 300 000')
    expect(texte).toMatch(/3[,.]30/)
    expect(document.body.textContent).not.toContain('pas pu être lus en entier')
  })

  it('drapeau levé : une somme illisible, ou la lecture refusée, se disent par le bandeau', async () => {
    faux.tenue = true
    faux.consommations = [{ cabinet_id: 'a', tokens_entree: -1, tokens_sortie: 0, tokens_entree_depuis: 0, tokens_sortie_depuis: 0 }]
    await act(async () => { render(<SuperAdminPage />) })
    expect(document.body.textContent).toContain('la consommation de 1 cabinet(s) ne se lit pas')
  })

  it('drapeau levé, la lecture refusée : le bandeau dit son motif', async () => {
    faux.tenue = true
    faux.refusConsommations = { message: 'Seul le super-administrateur lit la consommation de l’assistant.', code: '42501' }
    await act(async () => { render(<SuperAdminPage />) })
    expect(document.body.textContent).toContain('Seul le super-administrateur lit la consommation')
  })
})
