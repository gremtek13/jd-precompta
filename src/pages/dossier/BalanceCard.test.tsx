import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BalanceCard from './BalanceCard'

// Ce que ces tests gardent est le CÂBLAGE, pas la lecture : `balanceImport.ts` est couvert à part.
// Trois choses ne peuvent se voir qu'ici — le verdict d'équilibre effectivement AFFICHÉ (c'est la
// seule raison d'être de l'écran), la distinction entre « ce fichier n'est pas une balance » et
// « balance vide », et le décodage d'un export CP1252, qui ne se voit dans aucun test de module
// puisque le module reçoit déjà du texte.

// jsdom fournit File/Blob mais pas toujours `arrayBuffer()` : on le pose, en gardant les OCTETS
// exacts — c'est tout l'enjeu du test d'encodage.
function fichier(octets: Uint8Array<ArrayBuffer>, nom = 'balance.csv'): File {
  const f = new File([octets], nom, { type: 'text/csv' })
  Object.defineProperty(f, 'arrayBuffer', {
    value: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength),
  })
  return f
}

function octetsUtf8(texte: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(texte)
}

async function deposer(f: File) {
  const entree = document.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(entree, 'files', { value: [f], configurable: true })
  await act(async () => { entree.dispatchEvent(new Event('change', { bubbles: true })) })
}

const EQUILIBREE = [
  'Compte;Libelle;Debit;Credit',
  '401000;Fournisseurs;0,00;1 200,00',
  '606100;Achats;1 200,00;0,00',
  'TOTAUX;;1 200,00;1 200,00',
].join('\n')

describe('BalanceCard', () => {
  it('affiche le verdict d’équilibre, qui est la raison d’être de l’écran', async () => {
    render(<BalanceCard />)
    await deposer(fichier(octetsUtf8(EQUILIBREE)))

    expect(screen.getByText('équilibrée')).toBeTruthy()
    expect(screen.getByText(/2 comptes lus/)).toBeTruthy()
    // DEUX écartées, et il faut les deux : l'en-tête, et la ligne TOTAUX — qui n'a pas de numéro de
    // compte. L'inclure doublerait la balance et ferait passer un fichier parfait pour un fichier en
    // écart.
    expect(screen.getByText(/2 lignes écartées/)).toBeTruthy()
  })

  it('un écart se dit en chiffres, pas seulement par un badge', async () => {
    const ampute = [
      'Compte;Libelle;Debit;Credit',
      '401000;Fournisseurs;0,00;1 200,00',
      '606100;Achats;850,00;0,00',
    ].join('\n')
    render(<BalanceCard />)
    await deposer(fichier(octetsUtf8(ampute)))

    expect(screen.queryByText('équilibrée')).toBeNull()
    expect(screen.getByText(/écart de/)).toBeTruthy()
    expect(screen.getByText(/l’export ne contient pas tout/)).toBeTruthy()
  })

  it('distingue « pas une balance » de « balance vide »', async () => {
    // Un relevé bancaire déposé par erreur : des dates et des montants, aucun numéro de compte.
    const releve = ['Date;Libelle;Montant', '01/03/2025;VIREMENT;-120,00'].join('\n')
    render(<BalanceCard />)
    await deposer(fichier(octetsUtf8(releve), 'releve.csv'))

    expect(screen.getByText(/ne ressemble pas à une balance/)).toBeTruthy()
    // Le mot qui compte : l'écran doit écarter l'idée d'une balance vide, qui enverrait chercher un
    // défaut dans le fichier plutôt que dans le geste.
    expect(screen.getByText(/pas une balance vide/)).toBeTruthy()
  })

  it('lit un export CP1252 sans abîmer les libellés', async () => {
    // Le cas réel : un logiciel comptable français exporte en windows-1252. Décodé en UTF-8
    // indulgent, « Charges à payer » deviendrait « Charges Ã  payer » — et les libellés SONT les noms
    // de comptes, soit l'essentiel de ce qu'un humain lit ici.
    const texte = ['Compte;Libelle;Debit;Credit', '408000;Charges à payer;0,00;50,00'].join('\n')
    const cp1252 = Uint8Array.from([...texte].map((c) => c.charCodeAt(0)))
    // Contrôle du cas de test lui-même : ces octets ne SONT pas de l'UTF-8 valide, sinon le test ne
    // prouverait rien (il passerait avec le décodeur indulgent).
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(cp1252)).toThrow()

    render(<BalanceCard />)
    await deposer(fichier(cp1252))

    expect(screen.getByText('Charges à payer')).toBeTruthy()
  })
})
