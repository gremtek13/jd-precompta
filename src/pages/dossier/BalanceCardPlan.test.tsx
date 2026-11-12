import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BalanceCard from './BalanceCard'
import { AvecExercicesValides } from '../../test/exercicesValides'
import { PLAN_LU_PAR_DEFAUT } from '../../test/modeles'
import { type LectureDuPlan } from '../../lib/planComptable'
import { ROLES_DE_LA_BASE } from '../../test/rolesDeLaBase'

// LA REPRISE PROPOSE LE PLAN (ligne 43, étape PC6), À L'ÉCRAN : le câblage de la carte de la balance en deux temps, sous
// ses deux états du drapeau (`PLAN_DEPUIS_LA_BALANCE_PREVU`, joué par un accesseur). Le calcul est gardé à part
// (planDepuisLaBalance.test.ts, planDepuisLaBalanceVue.test.ts) ; ici, ce qu'aucun calcul pur ne voit : la lecture des
// catégories qui retient tout geste, le choix entre plusieurs comptes, l'écarté dit avant le clic, le réglage sous verrou
// PUIS la relecture du plan, et les à-nouveaux rangés sur le plan relu — la carte d'hier, drapeau baissé.

const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('../../lib/planDepuisLaBalance', async (original) => {
  const vrai = await original<typeof import('../../lib/planDepuisLaBalance')>()
  return { ...vrai, get PLAN_DEPUIS_LA_BALANCE_PREVU() { return drapeau.leve } }
})

const faux = vi.hoisted(() => ({
  categories: [] as Record<string, unknown>[],
  // Un `count` qui ment : la lecture des catégories revient en partie.
  categoriesEnPartie: false,
  lecturesCategories: 0,
  // Le plan que la base tient : le réglage le remplace, la relecture le rend.
  planEnBase: [] as { role: string; compte: string; libelle: string | null; prefixe_auxiliaire: string | null }[],
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  refusReglage: null as string | null,
  retenueReglage: null as Promise<void> | null,
  retenueRelecture: null as Promise<void> | null,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        order: () => chaine,
        eq: () => chaine,
        or: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        then: (suite: (r: unknown) => unknown) => {
          if (table === 'categories') {
            faux.lecturesCategories++
            const lignes = faux.categories.slice(debut, fin + 1)
            return Promise.resolve({ data: lignes, error: null, count: faux.categories.length + (faux.categoriesEnPartie ? 3 : 0) }).then(suite)
          }
          return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
        },
      })
      return chaine
    },
    rpc: async (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      if (nom === 'regler_plan_du_dossier') {
        if (faux.retenueReglage) await faux.retenueReglage
        if (faux.refusReglage) return { data: null, error: { message: faux.refusReglage } }
        faux.planEnBase = (args.p_comptes as typeof faux.planEnBase).map((l) => ({ ...l }))
        return { data: null, error: null }
      }
      if (nom === 'plan_du_dossier') {
        if (faux.retenueRelecture) await faux.retenueRelecture
        return {
          data: ROLES_DE_LA_BASE.map((r) => {
            const regle = faux.planEnBase.find((l) => l.role === r.role)
            return {
              role: r.role,
              compte: regle?.compte ?? r.compteDefaut,
              libelle: regle?.libelle ?? r.libelleDefaut,
              prefixe_auxiliaire: regle?.prefixe_auxiliaire ?? r.prefixeAuxiliaireDefaut,
            }
          }),
          error: null,
        }
      }
      return { data: 1, error: null }
    },
  },
}))

vi.mock('../../lib/extraction', () => ({ hashFichier: () => Promise.resolve('c'.repeat(64)) }))

function fichier(texte: string): File {
  const octets = new TextEncoder().encode(texte)
  const f = new File([octets], 'balance.csv', { type: 'text/csv' })
  Object.defineProperty(f, 'arrayBuffer', { value: async () => octets.buffer.slice(0) })
  return f
}

async function deposer(texte: string) {
  const entree = document.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(entree, 'files', { value: [fichier(texte)], configurable: true })
  await act(async () => { entree.dispatchEvent(new Event('change', { bubbles: true })) })
}

// Deux banques, un emprunt et le compte de l'exploitant au libellé du catalogue : seule la banque se choisit.
const DEUX_BANQUES = [
  'Compte;Libelle;Debit;Credit',
  '5121;Banque A;10 000,00;0,00',
  '5122;Banque B;2 000,00;0,00',
  '1640000;Emprunts auprès des établissements de crédit;0,00;8 000,00',
  '108;Compte de l\'exploitant;0,00;4 000,00',
].join('\n')

const plansRelus: [string, LectureDuPlan][] = []

async function monter() {
  render(
    <AvecExercicesValides annees={[]}>
      <BalanceCard dossierId="dossier-de-test" planLu={PLAN_LU_PAR_DEFAUT} onPlanRelu={(id, lecture) => { plansRelus.push([id, lecture]) }} />
    </AvecExercicesValides>,
  )
  await screen.findByText(/Aucun à-nouveau enregistré/)
}

const nomsDesAppels = () => faux.appels.map((a) => a.nom)

beforeEach(() => {
  drapeau.leve = true
  faux.categories = [{ id: 'c1', dossier_id: null, compte_comptable: '606100' }]
  faux.categoriesEnPartie = false
  faux.lecturesCategories = 0
  faux.planEnBase = []
  faux.appels = []
  faux.refusReglage = null
  faux.retenueReglage = null
  faux.retenueRelecture = null
  plansRelus.length = 0
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => { vi.restoreAllMocks() })

describe('BalanceCard — la reprise propose le plan (drapeau levé)', () => {
  it('fait choisir entre deux banques, règle le plan, le RELIT, puis range les à-nouveaux sur lui', async () => {
    await monter()
    await deposer(DEUX_BANQUES)

    expect(screen.getByText('1. Le plan que la balance propose')).toBeTruthy()
    // Tant que le cabinet n'a pas choisi : ni réglage, ni à-nouveaux.
    expect(screen.getByText(/La balance porte plusieurs comptes pour ce rôle : Banque\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Régler le plan' })).toBeNull()
    expect(screen.queryByText(/2\. Ouvrir le dossier/)).toBeNull()

    fireEvent.change(screen.getByLabelText('Compte du rôle « Banque »'), { target: { value: '512200' } })
    expect(screen.getByText('Banque : 512000 « Banque » → 512200 « Banque B »')).toBeTruthy()

    // La relecture est retenue : tant qu'elle n'est pas revenue, aucun à-nouveau ne se prépare.
    let relacher!: () => void
    faux.retenueRelecture = new Promise((r) => { relacher = r })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Régler le plan' })) })
    // La confirmation NOMME ce qui change.
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain('Banque : 512000 « Banque » → 512200 « Banque B »')
    expect(nomsDesAppels()).toEqual(['regler_plan_du_dossier', 'plan_du_dossier'])
    expect(faux.appels[0].args).toEqual({
      p_dossier_id: 'dossier-de-test',
      p_comptes: [{ role: 'banque', compte: '512200', libelle: 'Banque B', prefixe_auxiliaire: null }],
    })
    expect(screen.queryByText(/2\. Ouvrir le dossier/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Réglage…' })).toBeTruthy()

    await act(async () => { relacher() })
    expect(await screen.findByText('2. Ouvrir le dossier avec ces soldes, sur ce plan')).toBeTruthy()
    expect(screen.getByText(/Plan réglé et relu : un compte change\./)).toBeTruthy()
    expect(screen.getByText(/Le plan du dossier tient ce que tu retiens de la balance/)).toBeTruthy()
    // La page reçoit le plan relu, pour ce dossier.
    expect(plansRelus).toHaveLength(1)
    expect(plansRelus[0][0]).toBe('dossier-de-test')
    expect(plansRelus[0][1].plan?.banque).toBe('512200')
    // Les deux banques réunies sur la banque du plan RELU, dites, et le renvoi à la carte « Comptes bancaires ».
    expect(screen.getByText(/Les 2 comptes bancaires de la balance \(5121 Banque A, 5122 Banque B\) s’ouvrent réunis sur la banque du plan \(512200\)/)).toBeTruthy()
    expect(screen.getByText(/carte « Comptes bancaires »/)).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' })) })
    const enregistrement = faux.appels.find((a) => a.nom === 'enregistrer_a_nouveaux')!
    const lignes = enregistrement.args.p_lignes as { compte: string; compte_origine: string }[]
    expect(lignes.filter((l) => l.compte_origine.startsWith('512')).map((l) => l.compte)).toEqual(['512200', '512200'])
    // Rangé à des zéros près sur le compte du rôle : le 1640000 au 164000.
    expect(lignes.find((l) => l.compte_origine === '1640000')?.compte).toBe('164000')
  })

  it('garder le compte du plan, et décocher une proposition, laissent le plan à jour sans réglage', async () => {
    await monter()
    await deposer(['Compte;Libelle;Debit;Credit', '5121;Banque A;10 000,00;0,00', '5122;Banque B;2 000,00;0,00',
      '4455100;TVA à payer;0,00;12 000,00'].join('\n'))

    fireEvent.change(screen.getByLabelText('Compte du rôle « Banque »'), { target: { value: '' } })
    // Le libellé de la balance change celui du rôle : proposé, et coché.
    expect(screen.getByText('TVA à décaisser : 445510 « TVA à décaisser » → 445510 « TVA à payer »')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Retenir 445510 « TVA à payer »/))

    expect(screen.queryByRole('button', { name: 'Régler le plan' })).toBeNull()
    expect(screen.getByText('2. Ouvrir le dossier avec ces soldes, sur ce plan')).toBeTruthy()
    expect(nomsDesAppels()).toEqual([])
  })

  it('dit avant le clic le compte écarté parce qu’il est celui d’une catégorie, et ne l’envoie pas', async () => {
    faux.categories = [{ id: 'c1', dossier_id: null, compte_comptable: '625100' }]
    await monter()
    await deposer(['Compte;Libelle;Debit;Credit', '512000;Banque;500,00;0,00', '625100;Carburant;100,00;0,00',
      '101;Capital;0,00;500,00', '706000;Honoraires;0,00;100,00'].join('\n'))

    expect(screen.getByText(/Écarté : 625100 Carburant : c’est, à des zéros près, le compte d’une catégorie du dossier \(625100\)/)).toBeTruthy()
    // Les honoraires changent le libellé du 706000 : le réglage part, sans le 625100.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Régler le plan' })) })
    const comptes = faux.appels[0].args.p_comptes as { role: string }[]
    expect(comptes.map((c) => c.role)).not.toContain('indemnites_kilometriques')
  })

  it('deux clics dans le même act ne règlent le plan qu’une fois', async () => {
    await monter()
    await deposer(DEUX_BANQUES)
    fireEvent.change(screen.getByLabelText('Compte du rôle « Banque »'), { target: { value: '512100' } })

    let relacher!: () => void
    faux.retenueReglage = new Promise((r) => { relacher = r })
    const bouton = screen.getByRole('button', { name: 'Régler le plan' })
    await act(async () => { fireEvent.click(bouton); fireEvent.click(bouton) })
    await act(async () => { relacher() })
    await screen.findByText(/Plan réglé et relu/)
    expect(nomsDesAppels().filter((n) => n === 'regler_plan_du_dossier')).toHaveLength(1)
  })

  it('dit le refus de la base, ne relit rien, et relâche le verrou', async () => {
    faux.refusReglage = 'Le plan comptable de ce dossier ne se change plus : il porte déjà 2 à-nouveau(x), qui resteraient sur les anciens comptes.'
    await monter()
    await deposer(DEUX_BANQUES)
    fireEvent.change(screen.getByLabelText('Compte du rôle « Banque »'), { target: { value: '512100' } })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Régler le plan' })) })
    expect(screen.getByText(/ne se change plus : il porte déjà 2 à-nouveau/)).toBeTruthy()
    expect(nomsDesAppels()).toEqual(['regler_plan_du_dossier'])
    expect(plansRelus).toHaveLength(0)
    expect(screen.queryByText(/2\. Ouvrir le dossier/)).toBeNull()

    faux.refusReglage = null
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Régler le plan' })) })
    expect(nomsDesAppels()).toEqual(['regler_plan_du_dossier', 'regler_plan_du_dossier', 'plan_du_dossier'])
  })

  it('les catégories lues en partie retiennent tout geste : ni choix, ni réglage, ni à-nouveaux', async () => {
    faux.categoriesEnPartie = true
    await monter()
    await deposer(DEUX_BANQUES)

    expect(screen.getByText(/Les catégories du dossier n'ont pas pu être lues en entier/)).toBeTruthy()
    expect(screen.queryByLabelText('Compte du rôle « Banque »')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Régler le plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Enregistrer les à-nouveaux/ })).toBeNull()
    expect(nomsDesAppels()).toEqual([])
  })
})

describe('BalanceCard — drapeau baissé : la carte d’hier', () => {
  it('ne lit pas les catégories, ne propose aucun plan, et range toute banque sur celle du plan', async () => {
    drapeau.leve = false
    await monter()
    await deposer(DEUX_BANQUES)

    await waitFor(() => expect(screen.getByText('Ouvrir le dossier avec ces soldes')).toBeTruthy())
    expect(screen.queryByText('1. Le plan que la balance propose')).toBeNull()
    expect(faux.lecturesCategories).toBe(0)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les à-nouveaux' })) })
    expect(nomsDesAppels()).toEqual(['enregistrer_a_nouveaux'])
    const lignes = faux.appels[0].args.p_lignes as { compte: string; compte_origine: string }[]
    expect(lignes.filter((l) => l.compte_origine.startsWith('512')).map((l) => l.compte)).toEqual(['512000', '512000'])
    // Le rangement d'hier : le 1640000 s'ouvre sous son numéro.
    expect(lignes.find((l) => l.compte_origine === '1640000')?.compte).toBe('1640000')
  })
})
