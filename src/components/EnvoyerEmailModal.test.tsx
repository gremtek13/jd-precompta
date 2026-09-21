import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EnvoyerEmailModal from './EnvoyerEmailModal'

// Le verrou d'exécution de l'envoi d'e-mail — le porteur le plus coûteux du motif « un verrou est un
// `useRef`, jamais un état React » (CLAUDE.md). Les autres porteurs dupliquent une LIGNE, qu'un
// cabinet peut supprimer ; celui-ci envoie deux fois le même e-mail au client, et rien ne le retire
// de sa boîte. Le déclencheur n'est même pas un double clic : c'est un formulaire, donc deux
// « Entrée » rapprochés suffisent.
//
// Aucun calcul pur ne peut voir ce défaut : la fonction appelée derrière est parfaitement correcte,
// c'est le nombre d'appels qui est faux. D'où un test d'écran.
const faux = vi.hoisted(() => ({
  appels: [] as unknown[],
  // La promesse du premier envoi reste EN ATTENTE : c'est la fenêtre réelle pendant laquelle la
  // seconde soumission arrive. La résoudre tout de suite supprimerait la fenêtre que le verrou ferme.
  resoudre: null as null | ((v: unknown) => void),
  rejeter: null as null | ((e: unknown) => void),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (nom: string, options: unknown) => {
        faux.appels.push({ nom, options })
        return new Promise((resolve, reject) => { faux.resoudre = resolve; faux.rejeter = reject })
      },
    },
  },
}))

function monter() {
  faux.appels = []
  faux.resoudre = null
  faux.rejeter = null
  render(
    <EnvoyerEmailModal
      dossierId="d1"
      type="facture"
      destinataireInitial="client@exemple.fr"
      titre="Envoyer la facture"
      description="La facture part par e-mail."
      onClose={() => {}}
    />,
  )
  return screen.getByRole('button', { name: 'Envoyer' })
}

describe('EnvoyerEmailModal — le verrou d’envoi', () => {
  it("n'envoie qu'une fois quand on soumet deux fois de suite", async () => {
    const bouton = monter()

    // LES DEUX SOUMISSIONS DANS LE MÊME `act`. Deux `fireEvent.click` successifs ouvrent chacun leur
    // `act`, qui rend le composant en sortant : le second tomberait sur un bouton déjà re-rendu, avec
    // `envoi` à true, et le test resterait VERT avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.appels).toHaveLength(1)
  })

  // IL FAUT TROIS SOUMISSIONS pour distinguer un verrou posé avant le `try` d'un verrou posé dedans,
  // et la troisième éprouve aussi que le verrou n'est pas relâché par le refus lui-même.
  //
  // CE COMMENTAIRE DISAIT « ici il n'y a pas de `try` », ET C'ÉTAIT LE DÉFAUT, pas une particularité
  // à contourner : le relâchement vivait en clair après l'`await`, donc une exception laissait le
  // verrou pris pour de bon. Le test l'avait sous les yeux et l'a traité comme un décor. Corrigé le
  // 21/09/2026, après le même défaut dans `SuperPdpFactureModal` — voir le dernier cas ci-dessous.
  it("ne se relâche pas sur le refus d'une soumission surnuméraire", async () => {
    const bouton = monter()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toHaveLength(1)
  })

  it("laisse renvoyer après un échec, sinon le cabinet serait bloqué", async () => {
    const bouton = monter()
    await act(async () => { bouton.click() })
    expect(faux.appels).toHaveLength(1)

    // La fonction répond une erreur : le verrou doit se relâcher, sans quoi un envoi raté
    // condamnerait la modale jusqu'à sa réouverture.
    await act(async () => { faux.resoudre?.({ data: { error: 'Adresse refusée' }, error: null }) })
    expect(screen.getByText(/Adresse refusée/)).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: 'Envoyer' }).click() })
    expect(faux.appels).toHaveLength(2)
  })

  // LE CAS QUE CE FICHIER N'AVAIT PAS, et qui échouait avant le 21/09/2026. Une EXCEPTION n'est pas
  // une erreur rendue : elle sortait de `envoyer` sans relâcher quoi que ce soit, et l'écran se
  // figeait — bouton grisé, aucun message, aucun renvoi possible sans rouvrir la modale. Sur une
  // action qui SORT de l'application, ne pas savoir si l'e-mail est parti est le pire résultat.
  it('relâche le verrou sur une exception inattendue, et dit pourquoi', async () => {
    const bouton = monter()
    await act(async () => { bouton.click() })
    await act(async () => { faux.rejeter?.(new Error('Réseau injoignable')) })

    expect(screen.getByText(/Réseau injoignable/)).toBeTruthy()
    const relance = screen.getByRole('button', { name: 'Envoyer' }) as HTMLButtonElement
    expect(relance.disabled).toBe(false)
    await act(async () => { relance.click() })
    expect(faux.appels).toHaveLength(2)
  })
})
