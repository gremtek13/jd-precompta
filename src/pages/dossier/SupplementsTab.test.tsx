import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SupplementsTab from './SupplementsTab'
import type { CompteCourantAssocie, MouvementCca } from '../../lib/cca'

// SUPPRIMER UN MOUVEMENT DE COMPTE COURANT EST UNE ACTION QUE L'UTILISATEUR VIENT DE CONFIRMER.
//
// `supprimer` jetait le résultat de sa suppression, alors que sa fonction JUMELLE `ajouter` —
// trente lignes plus haut, dans le même composant, avec le même état d'erreur déjà affiché —
// lisait le sien. Exactement le couple `DocumentsTab.supprimer` / `supprimerSelection`.
//
// Le `onChanged()` qui suit recharge, donc la ligne réapparaît : c'est un signal, mais MUET et
// ambigu. Le réflexe est de reconfirmer et d'obtenir le même silence — le défaut déjà payé sur
// `SuperPdpModal.retirer()`. Et le solde d'un compte courant est TOUJOURS recalculé depuis
// l'historique complet : une ligne qu'on croit retirée et qui reste est un solde que le cabinet
// croit faux.
//
// Aucun test de `src/lib` ne peut voir ça : `soldeCca` est juste, la lecture est juste, c'est
// l'écran qui se taisait.
const faux = vi.hoisted(() => ({
  comptes: [] as CompteCourantAssocie[],
  mouvements: [] as MouvementCca[],
  erreurSuppression: null as { message: string } | null,
  suppressions: 0,
  rechargements: 0,
  // Les créations parties, dans l'ordre : UNE entrée = UNE ligne en base, que rien ne dédoublonne (`supplements`,
  // `comptes_courants_associes` et `mouvements_cca` n'ont d'unique que leur identifiant, relevé en base le 09/10/2026).
  creations: [] as { table: string; ligne: unknown }[],
  // La réponse d'une création attend que le test la libère : c'est la fenêtre réelle pendant laquelle un second envoi
  // arrive. La résoudre aussitôt supprimerait la fenêtre que le verrou ferme.
  porteCreation: null as Promise<void> | null,
  erreurCreation: null as { message: string } | null,
  // Les lectures aussi, à la demande : la relecture qui suit une création, pendant laquelle l'écran montre encore
  // la liste d'avant.
  porteLecture: null as Promise<void> | null,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let suppression = false
      let creation = false
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => (suppression ? Promise.resolve({ error: faux.erreurSuppression }) : chaine),
        in: () => chaine,
        order: () => chaine,
        range: () => chaine,
        delete: () => { suppression = true; faux.suppressions += 1; return chaine },
        insert: (ligne: unknown) => { creation = true; faux.creations.push({ table, ligne }); return chaine },
        then: (suite: (r: { data: unknown[] | null; error: { message: string } | null; count?: number }) => unknown) => {
          if (creation) {
            // Composée quand elle PART : une création retenue puis libérée répond selon l'état du moment de sa libération.
            const repondre = () => ({ data: null, error: faux.erreurCreation })
            return (faux.porteCreation ? faux.porteCreation.then(repondre) : Promise.resolve(repondre())).then(suite)
          }
          if (table === 'comptes_courants_associes') faux.rechargements += 1
          const lignes =
            table === 'comptes_courants_associes' ? faux.comptes
            : table === 'mouvements_cca' ? faux.mouvements
            : []
          return (faux.porteLecture ?? Promise.resolve())
            .then(() => ({ data: lignes, error: null, count: lignes.length })).then(suite)
        },
      })
      return chaine
    },
  },
}))

function compte(o: Partial<CompteCourantAssocie> = {}): CompteCourantAssocie {
  return {
    id: 'c1', dossier_id: 'd1', nom_associe: 'MARTIN', taux_interet_annuel: null,
    created_at: '2026-09-01T10:00:00Z', ...o,
  }
}

function mouvement(o: Partial<MouvementCca> = {}): MouvementCca {
  return {
    id: 'm1', compte_id: 'c1', date: '2026-03-10', type: 'apport', montant: 1500,
    libelle: 'Apport initial', created_at: '2026-03-10T09:00:00Z', ...o,
  }
}

async function ouvrirLesMouvements() {
  render(<SupplementsTab dossierId="d1" />)
  await act(async () => {})
  const ouvrir = screen.getByRole('button', { name: /^Mouvements$/ })
  await act(async () => { ouvrir.click() })
}

async function supprimerLaLigne() {
  // Deux boutons « Supprimer » cohabitent — celui de la CARTE du compte et celui de la LIGNE de
  // mouvement. On s'ancre donc sur la ligne qui porte le libellé, jamais sur un rang dans le
  // document : un test qui se tromperait de bouton supprimerait le compte entier et passerait.
  const ligne = screen.getByText('Apport initial').closest('tr')
  if (!ligne) throw new Error('ligne du mouvement introuvable')
  const bouton = within(ligne).getByRole('button', { name: /^Supprimer$/ })
  await act(async () => { bouton.click() })
}

beforeEach(() => {
  faux.comptes = [compte()]
  faux.mouvements = [mouvement()]
  faux.erreurSuppression = null
  faux.suppressions = 0
  faux.rechargements = 0
  faux.creations = []
  faux.porteCreation = null
  faux.erreurCreation = null
  faux.porteLecture = null
  window.confirm = () => true
})

// Une porte ou un refus laissés par un test qui échoue ne doivent pas faire échouer les suivants.
afterEach(() => {
  faux.porteCreation = null
  faux.porteLecture = null
  faux.erreurCreation = null
})

describe('mouvement de compte courant : une suppression refusée se dit', () => {
  it('DIT pourquoi quand la suppression échoue', async () => {
    // La RAISON rendue par Postgres, pas un repli plausible : c'est elle qui dit à l'opérateur
    // s'il doit corriger quelque chose, appeler l'administrateur ou réessayer.
    faux.erreurSuppression = { message: 'new row violates row-level security policy' }
    await ouvrirLesMouvements()
    await supprimerLaLigne()
    expect(screen.getByText(/row-level security/)).toBeTruthy()
  })

  it('ne recharge PAS derrière un échec', async () => {
    // Le rechargement est ce qui faisait passer l'échec pour un geste réussi puis annulé : la ligne
    // revenait, sans un mot. On s'arrête avant, et on le dit.
    faux.erreurSuppression = { message: 'refusé' }
    await ouvrirLesMouvements()
    const avant = faux.rechargements
    await supprimerLaLigne()
    expect(faux.rechargements).toBe(avant)
  })

  it('ne dit rien et recharge quand la suppression passe', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « l'écran dit l'échec » serait satisfait par un écran qui
    // crie au loup à chaque suppression, et on cesserait de le lire.
    faux.erreurSuppression = null
    await ouvrirLesMouvements()
    const avant = faux.rechargements
    await supprimerLaLigne()

    expect(faux.suppressions).toBe(1)
    expect(faux.rechargements).toBeGreaterThan(avant)
    expect(screen.queryAllByText(/n'a pas pu être supprimé/)).toHaveLength(0)
  })

  it('ne supprime rien quand la confirmation est refusée', async () => {
    // La garde qui rend le geste difficile à déclencher par distraction : un test qui la
    // contournerait ne décrirait plus le geste réel.
    window.confirm = () => false
    await ouvrirLesMouvements()
    await supprimerLaLigne()
    expect(faux.suppressions).toBe(0)
  })
})

// TROIS FORMULAIRES QUI NE SE PROTÉGEAIENT QUE PAR UN ÉTAT CRÉAIENT DEUX LIGNES (09/10/2026).
//
// « Nouvelle prestation », « Nouveau compte courant » et l'ajout d'un mouvement n'avaient pour garde que
// `disabled={saving}` : `setSaving(true)` ne prend effet qu'au rendu SUIVANT, donc deux soumissions rapprochées (deux
// « Entrée », un double clic) entraient toutes deux dans le gestionnaire, qui ne testait rien. Aucune de ces trois tables
// n'a d'unique que son identifiant : deux prestations à facturer, deux comptes courants du même associé, ou un apport
// compté deux fois dans un solde que le cabinet recalcule depuis l'historique et présente à la banque.
// Le verrou est un `useRef` posé avant le `try` : il faut TROIS envois pour distinguer un verrou posé dedans, dont le
// `return` du deuxième sortirait par le `finally` et relâcherait le verrou du premier.

// Retient la réponse des créations (ou des lectures) suivantes jusqu'à ce que le test appelle la fonction rendue.
function retenir(porte: 'porteCreation' | 'porteLecture'): () => Promise<void> {
  let ouvrir = () => {}
  faux[porte] = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux[porte] = null
    await act(async () => { ouvrir() })
  }
}

const creationsDe = (table: string) => faux.creations.filter((c) => c.table === table)

async function monterLOnglet() {
  render(<SupplementsTab dossierId="d1" />)
  await act(async () => {})
}

// Les champs requis sont remplis : jsdom bloque la soumission d'un formulaire tant qu'un champ requis est vide, et le clic
// n'atteindrait jamais le gestionnaire.
async function ouvrirUneNouvellePrestation() {
  await monterLOnglet()
  await act(async () => { screen.getByRole('button', { name: '+ Nouvelle prestation' }).click() })
  await act(async () => { fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Création de SASU' } }) })
  const bouton = screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement
  return { bouton, formulaire: bouton.closest('form')! }
}

async function ouvrirUnNouveauCompte() {
  await monterLOnglet()
  await act(async () => { screen.getByRole('button', { name: '+ Nouveau compte' }).click() })
  await act(async () => { fireEvent.change(screen.getByLabelText("Nom de l'associé"), { target: { value: 'DURAND' } }) })
  const bouton = screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement
  return { bouton, formulaire: bouton.closest('form')! }
}

async function saisirUnMouvement() {
  await ouvrirLesMouvements()
  const montant = screen.getByLabelText('Montant (€)')
  await act(async () => { fireEvent.change(montant, { target: { value: '250' } }) })
  const bouton = screen.getByRole('button', { name: 'Ajouter' }) as HTMLButtonElement
  return { bouton, formulaire: bouton.closest('form')!, montant }
}

describe.each([
  { quoi: 'une prestation ponctuelle', table: 'supplements', ouvrir: ouvrirUneNouvellePrestation, champ: 'Libellé' },
  { quoi: 'un compte courant d’associé', table: 'comptes_courants_associes', ouvrir: ouvrirUnNouveauCompte, champ: "Nom de l'associé" },
])('le verrou de création — $quoi', ({ table, ouvrir, champ }) => {
  it('ne crée qu’une ligne quand le formulaire est soumis deux fois dans le même rendu', async () => {
    const { bouton } = await ouvrir()
    const liberer = retenir('porteCreation')

    // LES DEUX CLICS DANS LE MÊME `act` : deux `act` successifs rendraient le composant entre les deux, et le second
    // tomberait sur un bouton déjà grisé — le test resterait vert avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    expect(creationsDe(table)).toHaveLength(1)
    // L'état, lui, reste pour l'AFFICHAGE : le bouton se grise et le dit pendant que la création est en vol.
    expect(bouton.disabled).toBe(true)
    expect(bouton.textContent).toBe('Enregistrement…')
    await liberer()
    // Une seule création, et la fenêtre se referme sur elle.
    expect(screen.queryByLabelText(champ)).toBeNull()
  })

  it('trois soumissions du formulaire — « Entrée » dans un champ — n’en créent qu’une', async () => {
    const { formulaire } = await ouvrir()
    const liberer = retenir('porteCreation')

    await act(async () => { for (let i = 0; i < 3; i++) fireEvent.submit(formulaire) })

    expect(creationsDe(table)).toHaveLength(1)
    await liberer()
  })

  it('relâche le verrou sur un refus de la base, pour laisser réessayer', async () => {
    faux.erreurCreation = { message: 'permission denied' }
    const { bouton } = await ouvrir()
    const liberer = retenir('porteCreation')

    await act(async () => { bouton.click() })
    await liberer()

    // Le refus est dit, et le formulaire reste ouvert avec ce qui a été saisi.
    expect(screen.getByText(/permission denied/)).toBeTruthy()
    expect(screen.getByLabelText(champ)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
    expect(creationsDe(table)).toHaveLength(2)
  })
})

describe('le verrou d’un mouvement de compte courant — la fenêtre reste ouverte sur ce qu’elle écrit', () => {
  it('n’ajoute qu’un mouvement quand « Ajouter » part deux fois dans le même rendu', async () => {
    const { bouton } = await saisirUnMouvement()
    const liberer = retenir('porteCreation')

    await act(async () => { bouton.click(); bouton.click() })

    expect(creationsDe('mouvements_cca')).toHaveLength(1)
    expect(creationsDe('mouvements_cca')[0].ligne).toMatchObject({ montant: 250, type: 'apport' })
    await liberer()
  })

  it('trois soumissions du formulaire n’en ajoutent qu’un', async () => {
    const { formulaire } = await saisirUnMouvement()
    const liberer = retenir('porteCreation')

    await act(async () => { for (let i = 0; i < 3; i++) fireEvent.submit(formulaire) })

    expect(creationsDe('mouvements_cca')).toHaveLength(1)
    await liberer()
  })

  it('relâche le verrou sur un refus de la base, pour laisser réessayer', async () => {
    faux.erreurCreation = { message: 'permission denied' }
    const { formulaire } = await saisirUnMouvement()

    await act(async () => { fireEvent.submit(formulaire) })
    expect(screen.getByText(/permission denied/)).toBeTruthy()
    await act(async () => { fireEvent.submit(formulaire) })

    expect(creationsDe('mouvements_cca')).toHaveLength(2)
  })

  // LE VERROU SE RELÂCHE APRÈS LA RELECTURE : la fenêtre reste ouverte, et tant que le compte n'est pas relu elle montre
  // la liste et le solde d'AVANT l'ajout. Relâché plus tôt, un second envoi partirait sur un solde qui ne compte pas
  // encore le premier.
  it('tient le verrou jusqu’à ce que le compte soit relu', async () => {
    const { formulaire, montant } = await saisirUnMouvement()
    const libererLaRelecture = retenir('porteLecture')

    await act(async () => { fireEvent.submit(formulaire) })
    expect(creationsDe('mouvements_cca')).toHaveLength(1)

    // Pendant la relecture : un nouveau montant, soumis par le formulaire lui-même (le bouton grisé n'y est pour rien).
    await act(async () => { fireEvent.change(montant, { target: { value: '40' } }) })
    await act(async () => { fireEvent.submit(formulaire) })
    expect(creationsDe('mouvements_cca')).toHaveLength(1)

    await libererLaRelecture()
    await act(async () => { fireEvent.submit(formulaire) })
    expect(creationsDe('mouvements_cca')).toHaveLength(2)
  })
})
