import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FactureFormModal from './FactureFormModal'
import type { ArticleExoneration, StatutTva } from '../../lib/types'

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
function monter(statutTva: StatutTva | null = 'franchise', articleExoneration: ArticleExoneration | null = null) {
  faux.appels = []
  faux.resoudre = null
  render(
    <FactureFormModal
      dossierId="d1"
      dossierNom="Cabinet de test"
      dossierSiret={null}
      dossierAdresse={null}
      statutTva={statutTva}
      articleExoneration={articleExoneration}
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

// L'EN-TÊTE EST LE TOTAL DES LIGNES QUI PARTENT (07/10/2026). Les totaux étaient calculés sur TOUTES les lignes affichées,
// et seules celles qui portent une désignation et une quantité positive partaient : une remise saisie en quantité
// négative diminuait le total de la facture sans figurer parmi ses lignes. La base stocke l'en-tête tel qu'il est
// envoyé, donc la facture validée se contredisait — à l'aperçu imprimé comme à la plateforme qui la reçoit, dont le
// validateur refuse un total qui n'est pas la somme des lignes. Latent : les six factures en base sont cohérentes.
describe('FactureFormModal — l’en-tête est le total des lignes qui partent', () => {
  const champs = (i: number) => document.querySelectorAll('tbody tr')[i].querySelectorAll('input')

  it('une ligne écartée n’entre pas dans les montants envoyés, et l’écran le dit', async () => {
    monter('redevable')
    fireEvent.change(champs(0)[2], { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    fireEvent.change(champs(1)[0], { target: { value: 'Remise' } })
    fireEvent.change(champs(1)[1], { target: { value: '-1' } })
    fireEvent.change(champs(1)[2], { target: { value: '30' } })
    expect(screen.getByText(/Une ligne ne partira pas avec la facture/)).toBeTruthy()

    await act(async () => { valider().click() })
    const args = faux.appels[0].args as { p_facture: Record<string, unknown>; p_lignes: unknown[] }
    expect(args.p_lignes).toEqual([{ designation: 'Prestation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }])
    expect(args.p_facture).toMatchObject({ montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
  })

  // LE GARDE SYMÉTRIQUE : une ligne neuve laissée vide n'est pas une ligne écartée qu'il faudrait signaler.
  it('ne dit rien d’une ligne neuve laissée vide', () => {
    monter('redevable')
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    expect(screen.queryByText(/ne partir(a|ont) pas/)).toBeNull()
  })
})

// LA FACTURE SUIT LE STATUT DE TVA DU DOSSIER (lib/statutTva.ts, ligne 28.5). La mention proposée était celle de la
// franchise pour tout dossier non assujetti, donc pour un dossier de soins exonérés ; et une ligne neuve partait à
// 0 % sur un redevable, que la plateforme recevait avec le motif de la franchise.
describe('FactureFormModal — la facture suit le statut de TVA du dossier', () => {
  const mentions = () => (document.querySelector('#mentions') as HTMLTextAreaElement).value
  const tauxDeLaLigne = (i = 0) => (document.querySelectorAll('tbody tr')[i].querySelectorAll('input')[3] as HTMLInputElement)

  it('un dossier de soins exonérés propose la mention de son article, jamais la franchise', () => {
    monter('exonere', 'cgi_261_4_1')
    expect(mentions()).toContain('Exonération de TVA, art. 261, 4, 1° du CGI.')
    expect(mentions()).not.toContain('293 B')
  })

  it('un dossier en franchise propose la mention de l’art. 293 B', () => {
    monter('franchise')
    expect(mentions()).toContain('TVA non applicable, art. 293 B du CGI.')
  })

  it('une ligne neuve part à 20 % sur un redevable, à 0 % ailleurs', () => {
    monter('redevable')
    expect(tauxDeLaLigne().value).toBe('20')
    fireEvent.click(screen.getByRole('button', { name: '+ Ligne' }))
    expect(tauxDeLaLigne(1).value).toBe('20')
    cleanup()
    monter('exonere', 'cgi_261_4_1')
    expect(tauxDeLaLigne().value).toBe('0')
  })

  it('une ligne taxée sur un dossier en franchise refuse la validation, et le dit', async () => {
    monter('franchise')
    fireEvent.change(tauxDeLaLigne(), { target: { value: '20' } })
    expect(screen.getByText(/Un dossier en franchise en base ne facture pas de TVA : une ligne à 20/)).toBeTruthy()
    expect(valider()).toHaveProperty('disabled', true)
    // Le brouillon reste enregistrable : le statut peut être en retard sur la réalité.
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer le brouillon' }).click() })
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].args.p_valider).toBe(false)
  })

  // GARDE SYMÉTRIQUE : une ligne à 0 % ne refuse rien, et un redevable facture la TVA.
  it('une ligne à 0 % d’un franchisé et une ligne taxée d’un redevable se valident', async () => {
    monter('franchise')
    expect(valider()).toHaveProperty('disabled', false)
    expect(screen.queryAllByText(/ne facture pas de TVA/)).toHaveLength(0)
    cleanup()
    monter('redevable')
    expect(valider()).toHaveProperty('disabled', false)
    await act(async () => { valider().click() })
    expect(faux.appels).toHaveLength(1)
  })

  it('une ligne à 0 % d’un redevable sans article le signale ; avec son article, propose sa mention', () => {
    monter('redevable')
    fireEvent.change(tauxDeLaLigne(), { target: { value: '0' } })
    expect(screen.getByText(/Une ligne à 0 % : sur un dossier redevable, l’exonération se justifie par son article/)).toBeTruthy()
    cleanup()

    monter('redevable', 'cgi_261_4_1')
    expect(screen.queryAllByText(/manque aux mentions légales/)).toHaveLength(0)
    fireEvent.change(tauxDeLaLigne(), { target: { value: '0' } })
    expect(screen.queryAllByText(/l’exonération se justifie par son article/)).toHaveLength(0)
    expect(screen.getByText(/La mention « Exonération de TVA, art. 261, 4, 1° du CGI\. » manque aux mentions légales/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la mention' }))
    expect(mentions()).toMatch(/^Exonération de TVA, art. 261, 4, 1° du CGI\.\n/)
    expect(screen.queryAllByText(/manque aux mentions légales/)).toHaveLength(0)
  })

  it('une mention effacée se propose de nouveau, et la franchise citée hors de son statut se signale', () => {
    monter('exonere', 'cgi_261_4_1')
    fireEvent.change(document.querySelector('#mentions')!, { target: { value: 'TVA non applicable, art. 293 B du CGI.' } })
    expect(screen.getByText(/La mention « Exonération de TVA, art. 261, 4, 1° du CGI\. » manque aux mentions légales/)).toBeTruthy()
    expect(screen.getByText(/Les mentions citent la franchise en base/)).toBeTruthy()
  })

  it('un statut à préciser, ou un exonéré sans article, le dit sous les mentions', () => {
    monter(null)
    expect(screen.getByText(/Le statut de TVA du dossier est à préciser/)).toBeTruthy()
    cleanup()
    monter('exonere', null)
    expect(screen.getByText(/Le dossier est exonéré sans article d’exonération/)).toBeTruthy()
    expect(screen.queryAllByText(/Les mentions citent la franchise en base/)).toHaveLength(0)
  })
})
