import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FactureFormModal from './FactureFormModal'

// DIXIÈME PORTEUR DU MOTIF « un verrou d'exécution est un `useRef`, jamais un état React »
// (CLAUDE.md) — et le plus cher des dix.
//
// `saving` est un état React, donc `disabled={!!saving}` ne ferme rien contre deux clics dans le
// même rendu. Deux « Valider la facture » rapprochés sur une facture NEUVE partent tous deux avec
// `p_facture_id = null` : `enregistrer_facture` prend alors sa branche INSERT deux fois, et chacune
// consomme son propre numéro de la suite annuelle (`attribuer_numero_facture`, upsert +1). Résultat :
// DEUX factures validées, identiques, numérotées à la suite, toutes deux IMMUABLES — l'écran ne
// propose la suppression que sur un brouillon, et la seule sortie légale est un avoir.
//
// Sur un brouillon EXISTANT la base rattrape (le `select … for update` sérialise, et le second appel
// se fait refuser « Une facture validée ne peut plus être modifiée ») : c'est la création qui n'a
// aucun filet, exactement comme `memberships UNIQUE` rattrape « Créer l'accès » et pas les autres.
//
// POURQUOI LE BALAYAGE DU 20/09/2026 NE L'A PAS VU, et c'est la vraie leçon : il cherchait
// `.insert(` / `functions.invoke` / `storage…upload` DANS LE CORPS DU GESTIONNAIRE. Ici l'écriture
// passe par `.rpc(` — la porte qu'`edgeFunctionsEcritures` avait déjà manquée — et depuis
// `src/lib/factures.ts`, donc hors du corps. Deux aveuglements indépendants, une seule panne : une
// liste d'inclusion tenue à la main ne contient que ce à quoi quelqu'un a pensé.

const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  // La promesse du premier appel reste EN ATTENTE : c'est la fenêtre réelle pendant laquelle un
  // second envoi arrive. La résoudre tout de suite supprimerait la fenêtre que le verrou ferme.
  resoudre: null as null | ((v: unknown) => void),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return new Promise((resolve) => { faux.resoudre = resolve })
    },
    // Volontairement bruyant : une table inattendue doit nommer ce que le test n'avait pas prévu,
    // plutôt que de rendre un objet vide et de faire échouer l'écran loin de la cause.
    from: (table: string) => { throw new Error(`Table non attendue dans ce test : ${table}`) },
  },
}))

// `enregistrerFacture` (lib/factures.ts) n'est PAS doublée : c'est elle qui appelle le RPC, donc la
// doubler compterait des appels à un faux au lieu des écritures réelles.
function monter() {
  faux.appels = []
  faux.resoudre = null
  render(
    <FactureFormModal
      dossierId="d1"
      dossierNom="Cabinet de test"
      dossierSiret={null}
      dossierAdresse={null}
      assujettiTva={false}
      facture={null}
      onAdresseUpdated={() => {}}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  )

  // Les deux seules conditions qu'`enregistrer` exige : un nom de client, et une ligne portant une
  // désignation (la quantité vaut déjà 1 par défaut).
  fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Client SARL' } })
  fireEvent.change(document.querySelectorAll('tbody input')[0]!, { target: { value: 'Prestation' } })
}

const valider = () => screen.getByRole('button', { name: 'Valider la facture' })

describe('FactureFormModal — le verrou d’enregistrement d’une facture', () => {
  it("n'enregistre qu'une seule facture quand on valide deux fois de suite", async () => {
    monter()

    // LES DEUX ENVOIS DANS LE MÊME `act` : deux `.click()` successifs ouvrent chacun leur `act`, qui
    // rend le composant en sortant — le second tomberait sur un bouton déjà re-rendu avec `saving` à
    // jour, et le test resterait VERT avec le défaut réinstallé (CLAUDE.md).
    const bouton = valider()
    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.appels).toHaveLength(1)
    // La validation est ce qui consomme le numéro : l'assertion porte sur ELLE, pas sur le seul
    // nombre d'appels — un second appel en brouillon ne coûterait pas la même chose.
    expect(faux.appels[0].args.p_valider).toBe(true)
  })

  // IL FAUT TROIS ENVOIS pour distinguer un verrou posé AVANT le `try` d'un verrou posé dedans : si
  // la pose vivait dans le `try`, le `return` du deuxième sortirait par le `finally`, qui relâcherait
  // le verrou du PREMIER — encore en cours — et le troisième repartirait pour une seconde facture.
  it('un troisième envoi ne crée pas de seconde facture', async () => {
    monter()
    const bouton = valider()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toHaveLength(1)
  })

  it('relâche le verrou sur un échec, pour laisser réessayer', async () => {
    monter()
    await act(async () => { valider().click() })
    expect(faux.appels).toHaveLength(1)

    await act(async () => { faux.resoudre?.({ data: null, error: { message: 'Numérotation refusée' } }) })
    expect(screen.getByText(/Numérotation refusée/)).toBeTruthy()

    await act(async () => { valider().click() })
    expect(faux.appels).toHaveLength(2)
  })

  // LE FORMULAIRE EST LE PIRE DÉCLENCHEUR, PAS LE DOUBLE CLIC : « Enregistrer le brouillon » est un
  // `type="submit"` dans un `<form>`, donc deux « Entrée » rapprochés dans n'importe quel champ
  // suffisent. Le doublon y coûte moins cher (un brouillon se supprime) mais le geste est le plus
  // banal des deux, et c'est le même verrou qui le ferme.
  it('couvre aussi la soumission du formulaire en brouillon', async () => {
    monter()
    const brouillon = screen.getByRole('button', { name: 'Enregistrer le brouillon' })
    await act(async () => { brouillon.click(); brouillon.click(); brouillon.click() })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].args.p_valider).toBe(false)
  })

  // GARDE SYMÉTRIQUE — sans lui, « on n'enregistre qu'une fois » serait satisfait par un écran qui
  // n'enregistre JAMAIS.
  it('enregistre bien quand on valide une seule fois', async () => {
    monter()
    await act(async () => { valider().click() })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].nom).toBe('enregistrer_facture')
  })
})
