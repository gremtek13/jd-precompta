import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { AuthWeakPasswordError, FunctionsHttpError } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CE_QUE_PERD_LE_CLIENT, CE_QUI_RESTE_AU_CLIENT, corpsDuMembre } from '../lib/creationDesComptes'
import { REGLE_DU_MOT_DE_PASSE, refusDuMotDePasse } from '../lib/recuperationMotDePasse'
import EquipePage from './EquipePage'

// « AJOUTER UN MEMBRE » NE SE PROTÉGEAIT QUE PAR UN ÉTAT (09/10/2026).
//
// `disabled={enregistrement}` ne prend effet qu'au rendu suivant : deux soumissions du même rendu (deux « Entrée », un
// double clic) appelaient deux fois `create-team-member` pour la même adresse. La base ne laisse pas entrer deux fois la
// même personne — mais le second appel trouve le compte que le premier vient de créer, et répond une ERREUR (« un compte
// existe déjà… », ou « appartient déjà à un cabinet ») sur un membre bien créé : l'écran garde le formulaire ouvert et dit
// l'échec d'une création réussie. Le même défaut qu'`AccesTab`, corrigé là le 24/09/2026.
//
// Aucun test de `src/lib` ne voit ça : le NOMBRE d'appels est faux, pas ce qu'on appelle. Le cas à TROIS envois est le
// seul à distinguer un verrou posé dans le `try`, dont le `return` du deuxième relâcherait celui du premier.
const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; body: unknown }[],
  // La réponse de la fonction attend `porte` quand le test la pose : la fenêtre pendant laquelle un second envoi arrive.
  porte: null as Promise<void> | null,
  refus: null as string | null,
  // Le corps d'un ajout réussi : ce que la fonction dit du compte (décision du cabinet du 10/10/2026).
  reponse: { ok: true } as unknown,
  // L'erreur que supabase-js rend sur un statut non-2xx (`FunctionsHttpError`, le corps sur son contexte), quand elle est posée.
  erreur: null as unknown,
  // Les réponses des appels suivants, une par appel, dans l'ordre (23Q2Q2-Q1 : le premier refuse avec son marqueur, le
  // second répond) : fabriquées à l'appel, chacune avec son corps neuf — un corps ne se lit qu'une fois.
  suite: [] as (() => { data: unknown; error: unknown })[],
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    // Les trois lectures de l'écran — membres, dossiers, affectations — rendent un cabinet sans personne d'autre, lu en
    // entier : rien de ce que ce test garde n'en dépend.
    from: () => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        order: () => chaine,
        range: () => chaine,
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(suite),
      })
      return chaine
    },
    functions: {
      invoke: async (nom: string, options: { body: unknown }) => {
        faux.appels.push({ nom, body: options.body })
        await faux.porte
        const suivante = faux.suite.shift()
        if (suivante) return suivante()
        if (faux.erreur) return { data: null, error: faux.erreur }
        return faux.refus ? { data: { error: faux.refus }, error: null } : { data: faux.reponse, error: null }
      },
    },
  },
}))

// Un `AuthProvider` complet ferait dépendre ce test d'une session Supabase (CLAUDE.md).
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, monCabinetId: 'cab1' }),
}))

beforeEach(() => {
  faux.appels = []
  faux.porte = null
  faux.refus = null
  faux.reponse = { ok: true }
  faux.erreur = null
  faux.suite = []
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

const creations = () => faux.appels.filter((a) => a.nom === 'create-team-member')

// Un mot de passe qui suit la règle du projet (lib/recuperationMotDePasse.ts) : sans elle, le formulaire refuse avant tout appel.
const MOT_DE_PASSE = 'Mot-de-passe-fictif-1'

// Les champs requis sont remplis : jsdom bloque la soumission d'un formulaire dont un champ requis est vide.
async function ouvrirLeFormulaire() {
  await act(async () => { render(<EquipePage />) })
  await act(async () => { screen.getByRole('button', { name: '+ Ajouter un membre' }).click() })
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nouvelle@cabinet-fictif.fr' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: MOT_DE_PASSE } })
  })
  const bouton = screen.getByRole('button', { name: 'Créer le compte' }) as HTMLButtonElement
  return { bouton, formulaire: bouton.closest('form')! }
}

describe('EquipePage — le verrou de l’ajout d’un membre', () => {
  it('ne crée le compte qu’une fois quand le formulaire est soumis deux fois dans le même rendu', async () => {
    const { bouton } = await ouvrirLeFormulaire()
    const liberer = retenirLaReponse()

    // LES DEUX CLICS DANS LE MÊME `act` : séparés, le second tomberait sur un bouton déjà grisé et le test resterait vert
    // avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    expect(creations()).toHaveLength(1)
    expect(creations()[0].body).toEqual({ email: 'nouvelle@cabinet-fictif.fr', password: MOT_DE_PASSE, role: 'comptable' })
    expect(bouton.disabled).toBe(true)
    expect(bouton.textContent).toBe('Création…')
    await liberer()
    // Le formulaire se referme sur la création réussie, sans un mot d'échec.
    expect(screen.queryByRole('heading', { name: "Ajouter un membre de l'équipe" })).toBeNull()
  })

  it('trois soumissions du formulaire — « Entrée » dans un champ — ne le créent qu’une fois', async () => {
    const { formulaire } = await ouvrirLeFormulaire()
    const liberer = retenirLaReponse()

    await act(async () => { for (let i = 0; i < 3; i++) fireEvent.submit(formulaire) })

    expect(creations()).toHaveLength(1)
    await liberer()
  })

  it('relâche le verrou sur un refus de la fonction, et le dit', async () => {
    faux.refus = 'Réservé aux chefs de cabinet.'
    const { bouton } = await ouvrirLeFormulaire()

    await act(async () => { bouton.click() })
    expect(screen.getByText('Réservé aux chefs de cabinet.')).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Créer le compte' }).click() })

    expect(creations()).toHaveLength(2)
  })
})

// CE QUE L'ÉCRAN DIT D'UN MEMBRE AJOUTÉ (décision du cabinet du 10/10/2026 : un compte qui existe déjà garde son mot de
// passe). La fonction dit lequel des deux cas s'est produit ; l'écran le dit au chef, faute de quoi il communiquerait un
// mot de passe qui n'a jamais été posé.
describe('EquipePage — ce que l’écran dit d’un membre ajouté', () => {
  const avis = () => screen.queryAllByRole('status').map((e) => e.textContent ?? '')

  it('un compte créé : l’avis nomme l’adresse, et le mot de passe saisi se communique', async () => {
    faux.reponse = { ok: true, compte: 'cree' }
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    expect(avis()).toEqual(["nouvelle@cabinet-fictif.fr a rejoint l'équipe : communique-lui le mot de passe que tu as saisi."])
  })

  it('un compte existant : la personne garde son mot de passe, celui saisi ne se communique pas', async () => {
    faux.reponse = { ok: true, compte: 'existant' }
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    const [texte, ...autres] = avis()
    expect(autres).toEqual([])
    expect(texte).toContain("nouvelle@cabinet-fictif.fr a rejoint l'équipe.")
    expect(texte).toContain('la personne garde son mot de passe actuel')
    expect(texte).toContain("celui saisi ici n'a pas été posé — ne le lui communique pas")
    expect(texte).toContain('« Mot de passe oublié »')
    expect(texte).not.toContain('communique-lui')
    // Le formulaire s'est refermé sur l'ajout réussi : l'avis vit sur la page.
    expect(screen.queryByRole('heading', { name: "Ajouter un membre de l'équipe" })).toBeNull()
  })

  it('une fonction d’avant le 10/10/2026, sans le champ : l’avis d’un compte créé — elle avait posé le mot de passe', async () => {
    faux.reponse = { ok: true }
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    expect(avis()).toEqual(["nouvelle@cabinet-fictif.fr a rejoint l'équipe : communique-lui le mot de passe que tu as saisi."])
  })

  it('une réponse qui ne dit rien de sûr : aucune promesse sur le mot de passe', async () => {
    faux.reponse = { ok: true, compte: 'repris' }
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    const [texte] = avis()
    expect(texte).toContain("le mot de passe saisi n'est peut-être pas le sien")
    expect(texte).not.toContain('communique-lui')
  })

  it('un refus de la fonction se dit, sans avis d’ajout', async () => {
    faux.refus = 'Cette personne appartient déjà à un cabinet (le sien ou un autre) : rien n’a changé, son mot de passe non plus.'
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    expect(screen.getByText(faux.refus)).toBeTruthy()
    expect(avis()).toEqual([])
  })

  it('un nouvel ajout efface l’avis du précédent : rien ne dit « a rejoint l’équipe » d’un ajout encore en vol', async () => {
    faux.reponse = { ok: true, compte: 'existant' }
    const { bouton } = await ouvrirLeFormulaire()
    await act(async () => { bouton.click() })
    expect(avis()).toHaveLength(1)

    await act(async () => { screen.getByRole('button', { name: '+ Ajouter un membre' }).click() })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'second@cabinet-fictif.fr' } })
      fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: MOT_DE_PASSE } })
    })
    faux.reponse = { ok: true, compte: 'cree' }
    const liberer = retenirLaReponse()
    await act(async () => { screen.getByRole('button', { name: 'Créer le compte' }).click() })
    expect(creations()).toHaveLength(2)
    expect(avis()).toEqual([])
    await liberer()
    expect(avis()).toEqual(["second@cabinet-fictif.fr a rejoint l'équipe : communique-lui le mot de passe que tu as saisi."])
  })
})

// LA RÈGLE DES MOTS DE PASSE DU PROJET (défaut 23.5, 10/10/2026). `create-team-member` prenait le refus d'un mot de passe
// par le service pour une adresse déjà inscrite. L'écran dit la règle avant le clic, refuse avant tout appel ce qui ne la
// suit pas, et montre tel quel le refus que la fonction traduit.
describe('EquipePage — la règle des mots de passe du projet', () => {
  async function ouvrir(motDePasse: string) {
    await act(async () => { render(<EquipePage />) })
    await act(async () => { screen.getByRole('button', { name: '+ Ajouter un membre' }).click() })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nouvelle@cabinet-fictif.fr' } })
      fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: motDePasse } })
    })
  }

  it('dit la règle sous le champ, avant le clic — et le navigateur n’y remplit pas le mot de passe du chef', async () => {
    await ouvrir('')
    const champ = screen.getByLabelText<HTMLInputElement>('Mot de passe')
    const regle = screen.getByText(REGLE_DU_MOT_DE_PASSE)
    expect(champ.getAttribute('aria-describedby')).toBe(regle.id)
    expect(champ.autocomplete).toBe('new-password')
    expect(champ.minLength).toBe(10)
  })

  it('un mot de passe qui ne suit pas la règle ne part pas : aucun appel, et l’écran dit ce qui manque', async () => {
    await ouvrir('mot-de-passe-fictif')
    await act(async () => { screen.getByRole('button', { name: 'Créer le compte' }).click() })
    expect(creations()).toEqual([])
    expect(screen.getByText('Ce mot de passe ne suit pas la règle du projet : il doit contenir une majuscule et un chiffre.')).toBeTruthy()
    // Le formulaire reste ouvert, et le mot de passe corrigé part aussitôt.
    await act(async () => { fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: MOT_DE_PASSE } }) })
    await act(async () => { screen.getByRole('button', { name: 'Créer le compte' }).click() })
    expect(creations()).toHaveLength(1)
  })

  // 23-Q5 : le maximum de bcrypt, 72 OCTETS (la fonction le rendait en 500 et en anglais). Trente-neuf caractères pour
  // soixante-quatorze octets : l'écran dit la limite sous le champ, puis refuse avant tout appel.
  it('un mot de passe de plus de 72 octets ne part pas, même court en caractères : la limite est dite avant le clic, puis le refus', async () => {
    await ouvrir(`${'é'.repeat(35)}Aa1!`)
    expect(screen.getByText(REGLE_DU_MOT_DE_PASSE).textContent).toContain('Au plus 72 octets')
    await act(async () => { screen.getByRole('button', { name: 'Créer le compte' }).click() })
    expect(creations()).toEqual([])
    expect(screen.getByText(
      'Ce mot de passe ne suit pas la règle du projet : il doit faire au plus 72 octets (une lettre accentuée ou un symbole comme « € » compte pour plusieurs octets, et celui-ci en fait 74).',
    )).toBeTruthy()
    // Soixante-douze octets tout juste : il part.
    await act(async () => { fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: `${'é'.repeat(34)}Aa1!` } }) })
    await act(async () => { screen.getByRole('button', { name: 'Créer le compte' }).click() })
    expect(creations()).toHaveLength(1)
  })

  it('le refus du service, traduit par la fonction (400), se dit tel quel, et le formulaire reste ouvert', async () => {
    const refus = refusDuMotDePasse(new AuthWeakPasswordError('Password is known to be weak and easy to guess, please choose a different one.', 422, ['pwned']))
    expect(refus).toMatch(/divulgués lors de fuites de données\.$/)
    faux.erreur = new FunctionsHttpError(new Response(JSON.stringify({ error: refus }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    await ouvrir(MOT_DE_PASSE)
    await act(async () => { screen.getByRole('button', { name: 'Créer le compte' }).click() })
    expect(await screen.findByText(refus as string)).toBeTruthy()
    expect(screen.queryAllByText(/Un compte existe déjà/)).toHaveLength(0)
    expect(screen.getByRole('heading', { name: "Ajouter un membre de l'équipe" })).toBeTruthy()
  })
})

// L'ENTRÉE DANS L'ÉQUIPE D'UN CLIENT DE CE CABINET (23Q2Q2-Q1, décision du cabinet du 26/10/2026 : « le confirmer, en
// nommant l'adresse, le rôle et ce qu'il perd »). `create-team-member` refuse le premier appel en 409, son corps portant
// le marqueur `entreeAConfirmer: true` ; la page ouvre alors une fenêtre — jamais `window.confirm` — qui nomme l'adresse et
// le rôle tels qu'ils sont partis, et ce que la personne perd ; confirmé, le second appel porte `entreeConfirmee: true`,
// sous le même verrou. Le patron de l'onglet Accès (23-Q2, AccesTab.test.tsx).
describe('EquipePage — l’entrée dans l’équipe d’un client de ce cabinet (23Q2Q2-Q1)', () => {
  const ADRESSE = 'Client.Du+Cabinet@example.test'
  const PHRASE = "Cette adresse est celle d'un client d'un dossier de ce cabinet : il n'entre dans l'équipe qu'après ta confirmation, et rien n'a été changé."
  const refus = (corps: unknown, statut = 409) => () => ({
    data: null,
    error: new FunctionsHttpError(new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } })),
  })
  const marqueur = refus({ error: PHRASE, entreeAConfirmer: true })
  const reussite = (compte: string) => () => ({ data: { ok: true, compte }, error: null })
  const fenetre = () => screen.queryByRole('alertdialog')
  const bouton = (nom: string) => screen.getByRole('button', { name: nom }) as HTMLButtonElement
  const avis = () => screen.queryAllByRole('status').map((e) => e.textContent ?? '')

  async function soumettre(role: 'comptable' | 'comptable_en_chef' = 'comptable_en_chef') {
    await act(async () => { render(<EquipePage />) })
    await act(async () => { screen.getByRole('button', { name: '+ Ajouter un membre' }).click() })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: ADRESSE } })
      fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: MOT_DE_PASSE } })
      fireEvent.change(screen.getByLabelText('Rôle'), { target: { value: role } })
    })
    const formulaire = bouton('Créer le compte').closest('form')!
    await act(async () => { bouton('Créer le compte').click() })
    return formulaire
  }

  it('le refus porteur du marqueur ouvre une fenêtre de la page, qui nomme l’adresse, le rôle et ce que la personne perd', async () => {
    const confirmer = vi.spyOn(window, 'confirm')
    faux.suite = [marqueur]
    const formulaire = await soumettre('comptable_en_chef')
    expect(creations().map((c) => c.body)).toEqual([corpsDuMembre(ADRESSE, MOT_DE_PASSE, 'comptable_en_chef', false)])
    const f = fenetre()
    expect(f).not.toBeNull()
    expect(screen.getByRole('heading', { name: "Faire entrer ce client dans l'équipe ?" })).toBeTruthy()
    // L'adresse telle qu'elle est partie, dans `.courriel`, qui ne la coupe pas au milieu d'un mot.
    expect(f!.querySelector('strong.courriel')?.textContent).toBe(ADRESSE)
    expect(f!.textContent).toContain(`elle y entrera comme « Comptable en chef », et elle verra et tiendra tous les dossiers du cabinet`)
    expect(f!.textContent).toContain(CE_QUE_PERD_LE_CLIENT)
    expect(f!.textContent).toContain(CE_QUI_RESTE_AU_CLIENT)
    expect(f!.textContent).toContain('Le mot de passe que tu as saisi ne sert pas')
    expect(confirmer).not.toHaveBeenCalled()
    // Le refus n'est pas dit comme une erreur : la fenêtre le remplace. Le formulaire reste rempli, et attend.
    expect(screen.queryByText(PHRASE)).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe(ADRESSE)
    expect(bouton('Créer le compte').disabled).toBe(true)
    expect((within(formulaire).getByRole('button', { name: 'Annuler' }) as HTMLButtonElement).disabled).toBe(true)
    confirmer.mockRestore()
  })

  it('le rôle « Comptable » se nomme avec ce qu’il ouvre', async () => {
    faux.suite = [marqueur]
    await soumettre('comptable')
    expect(fenetre()!.textContent).toContain('elle y entrera comme « Comptable », et elle ne verra que les dossiers que tu lui assignes, même parmi ceux dont elle est cliente.')
  })

  // Le voile est fixe et ne défile pas : une carte plus haute que l'écran laissait « Faire entrer dans l'équipe » hors
  // d'atteinte sur un petit téléphone (mesuré au banc, à 375 × 667 pixels). jsdom ne pose aucune mise en page : ce test tient
  // le style qui fait défiler la carte, le banc (`outils/captures/`) en mesure l'effet.
  it('la carte de la fenêtre défile au-delà de 92 % de la hauteur de l’écran, comme celle des autres fenêtres', async () => {
    faux.suite = [marqueur]
    await soumettre()
    const carte = fenetre() as HTMLElement
    expect(carte.style.maxHeight).toBe('92vh')
    expect(carte.style.overflowY).toBe('auto')
  })

  it('« Annuler » n’envoie rien, ferme la fenêtre et laisse le formulaire rempli', async () => {
    faux.suite = [marqueur]
    await soumettre()
    await act(async () => { within(fenetre()!).getByRole('button', { name: 'Annuler' }).click() })
    expect(fenetre()).toBeNull()
    expect(creations()).toHaveLength(1)
    expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe(ADRESSE)
    expect(screen.getByLabelText<HTMLInputElement>('Mot de passe').value).toBe(MOT_DE_PASSE)
    expect(bouton('Créer le compte').disabled).toBe(false)
  })

  it('« Faire entrer dans l’équipe » envoie le second appel — le booléen true, et ce qui est parti au premier —, puis dit l’avis', async () => {
    faux.suite = [marqueur, reussite('existant')]
    await soumettre('comptable_en_chef')
    await act(async () => { bouton("Faire entrer dans l'équipe").click() })
    expect(creations().map((c) => c.body)).toEqual([
      corpsDuMembre(ADRESSE, MOT_DE_PASSE, 'comptable_en_chef', false),
      corpsDuMembre(ADRESSE, MOT_DE_PASSE, 'comptable_en_chef', true),
    ])
    expect(creations()[1].body).toEqual({ email: ADRESSE, password: MOT_DE_PASSE, role: 'comptable_en_chef', entreeConfirmee: true })
    expect(fenetre()).toBeNull()
    expect(screen.queryByRole('heading', { name: "Ajouter un membre de l'équipe" })).toBeNull()
    const [texte, ...autres] = avis()
    expect(autres).toEqual([])
    expect(texte).toContain(`${ADRESSE} a rejoint l'équipe. Cette adresse avait déjà un compte`)
  })

  it('les champs changés derrière la fenêtre ne changent ni ce qu’elle nomme ni ce qui part', async () => {
    faux.suite = [marqueur, reussite('existant')]
    await soumettre('comptable')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'autre@example.test' } })
      fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'Autre-mot-de-passe-2' } })
      fireEvent.change(screen.getByLabelText('Rôle'), { target: { value: 'comptable_en_chef' } })
    })
    expect(fenetre()!.querySelector('strong.courriel')?.textContent).toBe(ADRESSE)
    expect(fenetre()!.textContent).toContain('« Comptable »,')
    await act(async () => { bouton("Faire entrer dans l'équipe").click() })
    expect(creations()[1].body).toEqual(corpsDuMembre(ADRESSE, MOT_DE_PASSE, 'comptable', true))
  })

  it('deux et trois clics sur la confirmation, dans le même `act`, ne l’envoient qu’une fois', async () => {
    faux.suite = [marqueur, reussite('existant')]
    await soumettre()
    const liberer = retenirLaReponse()
    const confirmer = bouton("Faire entrer dans l'équipe")
    await act(async () => { confirmer.click(); confirmer.click(); confirmer.click() })
    expect(creations()).toHaveLength(2)
    await liberer()
    expect(creations()).toHaveLength(2)
  })

  it('pendant l’appel, la fenêtre reste ouverte, ses deux boutons attendent, et le verrou tient contre une soumission', async () => {
    faux.suite = [marqueur, reussite('existant')]
    const formulaire = await soumettre()
    const liberer = retenirLaReponse()
    await act(async () => { bouton("Faire entrer dans l'équipe").click() })
    expect(fenetre()).not.toBeNull()
    const boutons = within(fenetre()!).getAllByRole('button') as HTMLButtonElement[]
    expect(boutons.map((b) => [b.textContent, b.disabled])).toEqual([['Annuler', true], ['Enregistrement…', true]])
    // Le verrou, et non le bouton grisé : une soumission du formulaire (« Entrée ») n'appelle rien de plus.
    await act(async () => { fireEvent.submit(formulaire) })
    expect(creations()).toHaveLength(2)
    await liberer()
    expect(fenetre()).toBeNull()
    expect(creations()).toHaveLength(2)
  })

  it('un refus du second appel se dit sous le formulaire, la fenêtre fermée, même s’il porte encore le marqueur', async () => {
    faux.suite = [marqueur, refus({ error: 'Cette personne appartient déjà à un cabinet.', entreeAConfirmer: true })]
    await soumettre()
    await act(async () => { bouton("Faire entrer dans l'équipe").click() })
    expect(await screen.findByText('Cette personne appartient déjà à un cabinet.')).toBeTruthy()
    expect(fenetre()).toBeNull()
    expect(creations()).toHaveLength(2)
    expect(avis()).toEqual([])
    expect(screen.getByRole('heading', { name: "Ajouter un membre de l'équipe" })).toBeTruthy()
    // Le verrou de la confirmation est relâché : le formulaire, toujours rempli, repart — un premier appel, sans confirmation.
    await act(async () => { bouton('Créer le compte').click() })
    expect(creations().map((c) => c.body)).toEqual([
      corpsDuMembre(ADRESSE, MOT_DE_PASSE, 'comptable_en_chef', false),
      corpsDuMembre(ADRESSE, MOT_DE_PASSE, 'comptable_en_chef', true),
      corpsDuMembre(ADRESSE, MOT_DE_PASSE, 'comptable_en_chef', false),
    ])
  })

  it('l’adresse saisie entre deux blancs : la fenêtre nomme celle qui est partie, et le second appel la renvoie telle quelle', async () => {
    faux.suite = [marqueur, reussite('existant')]
    await act(async () => { render(<EquipePage />) })
    await act(async () => { screen.getByRole('button', { name: '+ Ajouter un membre' }).click() })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: `  ${ADRESSE}  ` } })
      fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: MOT_DE_PASSE } })
    })
    await act(async () => { bouton('Créer le compte').click() })
    expect(fenetre()!.querySelector('strong.courriel')?.textContent).toBe(ADRESSE)
    await act(async () => { bouton("Faire entrer dans l'équipe").click() })
    expect(creations().map((c) => c.body)).toEqual([
      corpsDuMembre(ADRESSE, MOT_DE_PASSE, 'comptable', false),
      corpsDuMembre(ADRESSE, MOT_DE_PASSE, 'comptable', true),
    ])
    expect(avis()[0]).toContain(`${ADRESSE} a rejoint l'équipe.`)
  })

  it.each([
    ['sans marqueur', { error: 'Ce compte ne peut pas entrer dans l’équipe de ce cabinet.' }],
    ['un marqueur qui n’est pas true', { error: 'Ce compte ne peut pas entrer dans l’équipe de ce cabinet.', entreeAConfirmer: 'true' }],
    ['le marqueur du rattachement (23-Q2)', { error: 'Ce compte ne peut pas entrer dans l’équipe de ce cabinet.', rattachementAConfirmer: true }],
  ])('un refus %s se dit sous le formulaire, sans fenêtre', async (_quoi, corps) => {
    faux.suite = [refus(corps)]
    await soumettre()
    expect(await screen.findByText('Ce compte ne peut pas entrer dans l’équipe de ce cabinet.')).toBeTruthy()
    expect(fenetre()).toBeNull()
    expect(creations()).toHaveLength(1)
  })

  it('une nouvelle soumission ferme une confirmation restée ouverte', async () => {
    faux.suite = [marqueur, reussite('cree')]
    const formulaire = await soumettre()
    expect(fenetre()).not.toBeNull()
    await act(async () => { fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nouvelle@example.test' } }) })
    await act(async () => { fireEvent.submit(formulaire) })
    expect(fenetre()).toBeNull()
    expect(creations().map((c) => c.body)).toEqual([
      corpsDuMembre(ADRESSE, MOT_DE_PASSE, 'comptable_en_chef', false),
      corpsDuMembre('nouvelle@example.test', MOT_DE_PASSE, 'comptable_en_chef', false),
    ])
    expect(avis()).toEqual(["nouvelle@example.test a rejoint l'équipe : communique-lui le mot de passe que tu as saisi."])
  })
})
