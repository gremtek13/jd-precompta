import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BalanceCard from './BalanceCard'
import { AvecExercicesValides } from '../../test/exercicesValides'

// Ce que ces tests gardent est le CÂBLAGE, pas la lecture ni le calcul : `balanceImport.ts` et
// `aNouveaux.ts` sont couverts à part. Ce qui ne peut se voir qu'ici :
//   - le verdict d'équilibre effectivement AFFICHÉ, la distinction entre « ce fichier n'est pas une
//     balance » et « balance vide », et le décodage d'un export CP1252, que le module ne voit pas
//     puisqu'il reçoit déjà du texte ;
//   - l'enregistrement des à-nouveaux (décision du cabinet du 26/09/2026) : ce qui part à la base,
//     sous verrou, ce qui ne part pas sur une balance fausse ou une ouverture illisible, et les deux
//     confirmations qui nomment ce qu'on perd.

const faux = vi.hoisted(() => ({
  aNouveaux: [] as Record<string, unknown>[],
  erreurLecture: null as string | null,
  appelsRpc: [] as Record<string, unknown>[],
  erreurRpc: null as string | null,
  // Retient la réponse de l'enregistrement jusqu'à ce que le test relâche : la fenêtre où un second
  // clic ne doit rien renvoyer.
  retenueRpc: null as Promise<void> | null,
  relacherRpc: null as (() => void) | null,
  suppressions: [] as [string, unknown][],
  erreurSuppression: null as string | null,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      let suppression = false
      const filtres: [string, unknown][] = []
      Object.assign(chaine, {
        select: () => chaine,
        order: () => chaine,
        eq: (colonne: string, valeur: unknown) => { filtres.push([colonne, valeur]); return chaine },
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        delete: () => { suppression = true; return chaine },
        then: (suite: (r: unknown) => unknown) => {
          if (table !== 'a_nouveaux') return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
          if (suppression) {
            faux.suppressions.push(...filtres)
            if (faux.erreurSuppression) return Promise.resolve({ data: null, error: { message: faux.erreurSuppression } }).then(suite)
            faux.aNouveaux = []
            return Promise.resolve({ data: null, error: null }).then(suite)
          }
          if (faux.erreurLecture) {
            return Promise.resolve({ data: null, error: { message: faux.erreurLecture }, count: null }).then(suite)
          }
          return Promise.resolve({ data: faux.aNouveaux.slice(debut, fin + 1), error: null, count: faux.aNouveaux.length }).then(suite)
        },
      })
      return chaine
    },
    // L'enregistrement MORD sur la table du faux, comme la vraie fonction : la relecture qui suit voit
    // l'ouverture qu'on vient d'écrire.
    rpc: async (nom: string, args: Record<string, unknown>) => {
      faux.appelsRpc.push({ nom, ...args })
      if (faux.retenueRpc) await faux.retenueRpc
      if (faux.erreurRpc) return { data: null, error: { message: faux.erreurRpc } }
      const lignes = args.p_lignes as Record<string, unknown>[]
      faux.aNouveaux = lignes.map((l, i) => ({
        id: `an-${i}`, dossier_id: args.p_dossier_id, date: args.p_date, ...l,
        compte_origine: l.compte_origine || null, source_nom: args.p_source_nom,
        source_empreinte: args.p_source_empreinte, created_at: '2026-09-26T10:00:00Z',
      }))
      return { data: lignes.length, error: null }
    },
  },
}))

// L'empreinte du fichier : ce qui compte ici est qu'elle PARTE avec les à-nouveaux, pas son calcul.
vi.mock('../../lib/extraction', () => ({ hashFichier: () => Promise.resolve('c'.repeat(64)) }))

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

// Une balance d'avant clôture, équilibrée : des comptes de bilan, et un bénéfice de 15 000 €.
const AVANT_CLOTURE = [
  'Compte;Libelle;Debit;Credit',
  '2183;Matériel informatique;3 000,00;0,00',
  '28183;Amortissements;0,00;1 200,00',
  '164;Emprunts;0,00;8 000,00',
  '51210000;Banque Populaire;10 000,00;4 000,00',
  '108;Compte de l’exploitant;15 200,00;0,00',
  '606100;Achats;5 000,00;0,00',
  '706000;Honoraires;0,00;20 000,00',
].join('\n')

const ANNEE = new Date().getFullYear()

// Les exercices validés que la page du dossier fournit (DossierDetail) : aucun par défaut.
async function monter(valides: readonly number[] = []) {
  render(<AvecExercicesValides annees={valides}><BalanceCard dossierId="dossier-de-test" /></AvecExercicesValides>)
  // L'ouverture existante est lue au montage : l'enregistrement l'attend.
  await screen.findByText(/Aucun à-nouveau enregistré|Ouverture enregistrée|Les à-nouveaux du dossier n'ont pas pu/)
}

function ouvertureExistante() {
  faux.aNouveaux = [
    { id: 'x1', dossier_id: 'dossier-de-test', date: '2025-01-01', compte: '512000', compte_origine: '5121', libelle: 'Banque', sens: 'debit', montant: 900, source_nom: 'ancienne.csv', source_empreinte: 'd'.repeat(64), created_at: '2026-01-10T10:00:00Z' },
    { id: 'x2', dossier_id: 'dossier-de-test', date: '2025-01-01', compte: '108', compte_origine: '108', libelle: 'Compte de l’exploitant', sens: 'credit', montant: 900, source_nom: 'ancienne.csv', source_empreinte: 'd'.repeat(64), created_at: '2026-01-10T10:00:00Z' },
  ]
}

beforeEach(() => {
  faux.aNouveaux = []
  faux.erreurLecture = null
  faux.appelsRpc = []
  faux.erreurRpc = null
  faux.retenueRpc = null
  faux.relacherRpc = null
  faux.suppressions = []
  faux.erreurSuppression = null
})

afterEach(() => { vi.restoreAllMocks() })

describe('BalanceCard — lire et contrôler', () => {
  it('affiche le verdict d’équilibre, qui est la raison d’être de l’écran', async () => {
    await monter()
    await deposer(fichier(octetsUtf8(EQUILIBREE)))

    expect(screen.getByText('équilibrée')).toBeTruthy()
    expect(screen.getByText(/2 comptes lus/)).toBeTruthy()
    // DEUX écartées, et il faut les deux : l'en-tête, et la ligne TOTAUX — qui n'a pas de numéro de
    // compte. L'inclure doublerait la balance et ferait passer un fichier parfait pour un fichier en
    // écart.
    expect(screen.getByText(/2 lignes écartées/)).toBeTruthy()
  })

  it('un écart se dit en chiffres, et n’ouvre rien', async () => {
    const ampute = [
      'Compte;Libelle;Debit;Credit',
      '401000;Fournisseurs;0,00;1 200,00',
      '606100;Achats;850,00;0,00',
    ].join('\n')
    await monter()
    await deposer(fichier(octetsUtf8(ampute)))

    expect(screen.queryByText('équilibrée')).toBeNull()
    expect(screen.getByText(/écart de/)).toBeTruthy()
    expect(screen.getByText(/l’export ne contient pas tout/)).toBeTruthy()
    // Des soldes dont on sait qu'ils sont faux n'ouvrent pas un dossier.
    expect(screen.queryAllByText('Ouvrir le dossier avec ces soldes')).toHaveLength(0)
  })

  it('distingue « pas une balance » de « balance vide »', async () => {
    // Un relevé bancaire déposé par erreur : des dates et des montants, aucun numéro de compte.
    const releve = ['Date;Libelle;Montant', '01/03/2025;VIREMENT;-120,00'].join('\n')
    await monter()
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

    await monter()
    await deposer(fichier(cp1252))

    expect(screen.getByText('Charges à payer')).toBeTruthy()
  })
})

describe('BalanceCard — en faire les à-nouveaux du dossier', () => {
  it('montre ce qui sera écrit, puis l’enregistre avec l’empreinte de la balance', async () => {
    await monter()
    await deposer(fichier(octetsUtf8(AVANT_CLOTURE)))

    expect(screen.getByText(new RegExp(`^6 à-nouveaux au 01/01/${ANNEE} — 24\\s200,00\\s€ au débit comme au crédit\\.$`))).toBeTruthy()
    expect(screen.getByText(new RegExp(`Résultat de l’exercice ${ANNEE - 1} \\(bénéfice\\), en attente d’affectation : 15\\s000,00\\s€ au crédit du 120000`))).toBeTruthy()
    expect(screen.getByText(/51210000 Banque Populaire → 512000/)).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' }).click() })

    expect(faux.appelsRpc).toHaveLength(1)
    const appel = faux.appelsRpc[0]
    expect(appel).toMatchObject({
      nom: 'enregistrer_a_nouveaux', p_dossier_id: 'dossier-de-test', p_date: `${ANNEE}-01-01`,
      p_source_nom: 'balance.csv', p_source_empreinte: 'c'.repeat(64),
    })
    expect(appel.p_lignes).toEqual([
      { compte: '2183', compte_origine: '2183', libelle: 'Matériel informatique', sens: 'debit', montant: 3000 },
      { compte: '28183', compte_origine: '28183', libelle: 'Amortissements', sens: 'credit', montant: 1200 },
      { compte: '164', compte_origine: '164', libelle: 'Emprunts', sens: 'credit', montant: 8000 },
      { compte: '512000', compte_origine: '51210000', libelle: 'Banque Populaire', sens: 'debit', montant: 6000 },
      { compte: '108', compte_origine: '108', libelle: 'Compte de l’exploitant', sens: 'debit', montant: 15200 },
      { compte: '120000', compte_origine: '', libelle: `Résultat de l’exercice ${ANNEE - 1} (bénéfice), en attente d’affectation`, sens: 'credit', montant: 15000 },
    ])
    expect(screen.getByText(`6 à-nouveaux enregistrés : ils ouvrent l’exercice ${ANNEE}.`)).toBeTruthy()
    // La relecture montre l'ouverture qu'on vient d'écrire.
    expect(await screen.findByText(/Ouverture enregistrée/)).toBeTruthy()
  })

  it('refuse, en le disant, une balance dont la classe 8 n’est pas soldée', async () => {
    const avecCloture = [
      'Compte;Libelle;Debit;Credit',
      '512;Banque;5 700,00;0,00',
      '108;Exploitant;0,00;5 000,00',
      '890;Bilan d’ouverture;0,00;700,00',
    ].join('\n')
    await monter()
    await deposer(fichier(octetsUtf8(avecCloture)))

    expect(screen.getByText(/classe 8 de cette balance ne sont pas soldés/)).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /à-nouveaux/ })).toHaveLength(0)
  })

  it('trois clics rapprochés n’enregistrent qu’une fois', async () => {
    faux.retenueRpc = new Promise<void>((r) => { faux.relacherRpc = r })
    await monter()
    await deposer(fichier(octetsUtf8(AVANT_CLOTURE)))

    const bouton = screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appelsRpc).toHaveLength(1)

    await act(async () => { faux.relacherRpc!() })
    expect(await screen.findByText(/Ouverture enregistrée/)).toBeTruthy()
  })

  it('dit le refus de la base, et relâche le verrou pour un nouvel essai', async () => {
    faux.erreurRpc = 'À-nouveaux déséquilibrés : 10 au débit, 9 au crédit.'
    await monter()
    await deposer(fichier(octetsUtf8(AVANT_CLOTURE)))

    await act(async () => { screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' }).click() })
    expect(screen.getByText('À-nouveaux déséquilibrés : 10 au débit, 9 au crédit.')).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' }).click() })
    expect(faux.appelsRpc).toHaveLength(2)
  })

  it('demande avant de REMPLACER une ouverture, en la nommant', async () => {
    ouvertureExistante()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await monter()
    await deposer(fichier(octetsUtf8(AVANT_CLOTURE)))

    await act(async () => { screen.getByRole('button', { name: 'Remplacer les à-nouveaux' }).click() })
    expect(confirmer).toHaveBeenCalledWith(expect.stringContaining('Remplacer les 2 à-nouveaux du 01/01/2025, repris de ancienne.csv'))
    expect(faux.appelsRpc).toHaveLength(0)

    confirmer.mockReturnValue(true)
    await act(async () => { screen.getByRole('button', { name: 'Remplacer les à-nouveaux' }).click() })
    expect(faux.appelsRpc).toHaveLength(1)
  })

  // GARDE SYMÉTRIQUE : sans elle, « on demande avant de remplacer » serait satisfait par un écran qui
  // demande toujours — une confirmation qu'on voit à chaque fois finit par se fermer sans être lue.
  it('ne demande rien quand il n’y a rien à remplacer', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await monter()
    await deposer(fichier(octetsUtf8(AVANT_CLOTURE)))

    await act(async () => { screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' }).click() })
    expect(confirmer).not.toHaveBeenCalled()
    expect(faux.appelsRpc).toHaveLength(1)
  })

  // Ce test garde le BOUTON grisé. La garde posée dans le gestionnaire lui-même n'est atteinte par
  // aucun clic, le bouton l'étant déjà : c'est une seconde ceinture, et sa mutation survit à juste
  // titre — même statut que le refus côté gestionnaire de ClotureTab.
  it('suspend l’enregistrement quand l’ouverture existante n’a pas pu être lue', async () => {
    faux.erreurLecture = 'JWT expired'
    await monter()
    await deposer(fichier(octetsUtf8(AVANT_CLOTURE)))

    expect(screen.getByText(/Les à-nouveaux du dossier n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('BalanceCard — retirer l’ouverture', () => {
  it('demande en nommant ce qu’on perd, et ne retire rien sans accord', async () => {
    ouvertureExistante()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await monter()

    await act(async () => { screen.getByRole('button', { name: 'Retirer les à-nouveaux' }).click() })
    const message = confirmer.mock.calls[0][0] as string
    expect(message).toContain('Retirer les 2 à-nouveaux du 01/01/2025, repris de ancienne.csv')
    expect(message).toContain('repartiront de zéro')
    expect(message).toContain('il faudra la redéposer')
    expect(faux.suppressions).toHaveLength(0)
  })

  it('retire l’ouverture du seul dossier, puis le dit', async () => {
    ouvertureExistante()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await monter()

    await act(async () => { screen.getByRole('button', { name: 'Retirer les à-nouveaux' }).click() })
    expect(faux.suppressions).toEqual([['dossier_id', 'dossier-de-test']])
    expect(await screen.findByText('Aucun à-nouveau enregistré pour ce dossier.')).toBeTruthy()
  })

  it('dit un retrait refusé, et l’ouverture reste affichée', async () => {
    ouvertureExistante()
    faux.erreurSuppression = 'permission denied for table a_nouveaux'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await monter()

    await act(async () => { screen.getByRole('button', { name: 'Retirer les à-nouveaux' }).click() })
    expect(screen.getByText('permission denied for table a_nouveaux')).toBeTruthy()
    expect(screen.getByText(/Ouverture enregistrée/)).toBeTruthy()
  })
})

// UN EXERCICE VALIDÉ FIGE L'OUVERTURE (ligne 26.6, étape d) : dès qu'un exercice du dossier l'est, les à-nouveaux ne
// s'enregistrent, ne se remplacent ni ne se retirent plus (`garder_a_nouveaux_valides`). La carte le dit à la place des
// deux boutons ; la balance se lit et se contrôle toujours — c'est une question sur un fichier, pas une écriture.
describe('BalanceCard — une ouverture figée par un exercice validé', () => {
  const PHRASE = 'Un exercice de ce dossier est validé : son ouverture ne change plus.'

  it('ne se retire plus, et le dit', async () => {
    ouvertureExistante()
    await monter([2025])

    expect(screen.queryByRole('button', { name: 'Retirer les à-nouveaux' })).toBeNull()
    expect(screen.getByText(PHRASE)).toBeTruthy()
    expect(screen.getByText(/Ouverture enregistrée/)).toBeTruthy()
  })

  it('ne se remplace plus : la balance se contrôle, la préparation se lit, rien ne part', async () => {
    ouvertureExistante()
    await monter([2025])
    await deposer(fichier(octetsUtf8(AVANT_CLOTURE)))

    expect(screen.getByText('équilibrée')).toBeTruthy()
    expect(screen.getByText(new RegExp(`^6 à-nouveaux au 01/01/${ANNEE}`))).toBeTruthy()
    expect(screen.queryByRole('button', { name: /à-nouveaux/ })).toBeNull()
    expect(screen.getAllByText(PHRASE)).toHaveLength(2)
    expect(faux.appelsRpc).toHaveLength(0)
  })

  it('ne s’enregistre plus sur un dossier sans ouverture dont un exercice est validé', async () => {
    await monter([2025])
    await deposer(fichier(octetsUtf8(AVANT_CLOTURE)))

    expect(screen.queryByRole('button', { name: 'Enregistrer les à-nouveaux' })).toBeNull()
    expect(screen.getByText(PHRASE)).toBeTruthy()
  })
})
