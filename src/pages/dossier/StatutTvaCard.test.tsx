import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import StatutTvaCard, { FacturationElectroniqueCard, type ModificationStatutTva } from './StatutTvaCard'
import type { ArticleExoneration, StatutTva } from '../../lib/types'

// LE STATUT DE TVA DU DOSSIER SE RÈGLE ICI (ligne 28.5, étape a) : trois statuts, l'article d'une exonération,
// puis « Enregistrer ». Ce que ce test garde, et qu'aucun test de src/lib ne peut voir : que rien ne s'écrive avant
// le clic, que la franchise parte sans article, que la page reçoive ce que la BASE a écrit — le booléen qu'elle en
// déduit compris —, qu'un refus se dise, et qu'un double clic n'écrive qu'une fois.

const faux = vi.hoisted(() => ({
  ecritures: [] as { table: string; valeurs: Record<string, unknown>; id: string }[],
  refus: null as string | null,
  // Non nul : la base retient sa réponse jusqu'à ce que le test la libère.
  retenue: null as null | Promise<void>,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (valeurs: Record<string, unknown>) => ({
        eq: (_colonne: string, id: string) => ({
          select: () => ({
            single: () => {
              faux.ecritures.push({ table, valeurs, id })
              return (faux.retenue ?? Promise.resolve()).then(() => (faux.refus
                ? { data: null, error: { message: faux.refus } }
                // Le déclencheur `dossiers_deduire_assujetti_tva` : le booléen suit le statut.
                : { data: { ...valeurs, assujetti_tva: valeurs.statut_tva === 'redevable' }, error: null }))
            },
          }),
        }),
      }),
    }),
  },
}))

function retenue(): { promesse: Promise<void>; relacher: () => void } {
  let relacher: () => void = () => {}
  const promesse = new Promise<void>((resolve) => { relacher = resolve })
  return { promesse, relacher }
}

// Comme la page du dossier : ce que la base a écrit devient le statut que la carte reçoit.
function Hote({ statut, article, rendus }: { statut: StatutTva | null; article: ArticleExoneration | null; rendus: ModificationStatutTva[] }) {
  const [tva, setTva] = useState({ statut, article })
  return (
    <StatutTvaCard
      dossierId="d1"
      statut={tva.statut}
      article={tva.article}
      onStatutUpdated={(m) => { rendus.push(m); setTva({ statut: m.statut_tva, article: m.article_exoneration }) }}
    />
  )
}

function monter(statut: StatutTva | null, article: ArticleExoneration | null = null) {
  faux.ecritures = []
  faux.refus = null
  faux.retenue = null
  const rendus: ModificationStatutTva[] = []
  render(<Hote statut={statut} article={article} rendus={rendus} />)
  return rendus
}

const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom })
const enregistrer = () => bouton('Enregistrer')

describe('StatutTvaCard — choisir le statut de TVA du dossier', () => {
  it('un statut à préciser s’ouvre en édition, le dit, et n’enregistre rien sans choix', () => {
    monter(null)
    expect(screen.getByText(/Le statut de TVA de ce dossier est à préciser/)).toBeTruthy()
    expect(enregistrer()).toHaveProperty('disabled', true)
    // Pas d'« Annuler » : il n'y a pas de statut auquel revenir.
    expect(screen.queryAllByRole('button', { name: 'Annuler' })).toHaveLength(0)
  })

  it('exonéré avec son article : la mention se lit avant le clic, et la page reçoit ce que la base a écrit', async () => {
    const rendus = monter(null)
    fireEvent.click(bouton('Exonéré (art. 261 à 261 E du CGI)'))
    expect(bouton('Exonéré (art. 261 à 261 E du CGI)').getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(screen.getByLabelText('Article de l’exonération'), { target: { value: 'cgi_261_4_1' } })
    // Une liste qui change n'écrit rien : seul le clic sur « Enregistrer » le fait.
    expect(faux.ecritures).toHaveLength(0)
    expect(screen.getByText('Mention proposée sur ses factures : « Exonération de TVA, art. 261, 4, 1° du CGI. »')).toBeTruthy()

    await act(async () => { enregistrer().click() })
    expect(faux.ecritures).toEqual([{
      table: 'dossiers', id: 'd1', valeurs: { statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1' },
    }])
    expect(rendus).toEqual([{ statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1', assujetti_tva: false }])
    // De retour en lecture : le statut et son article.
    expect(screen.getByText('Exonéré (art. 261 à 261 E du CGI)')).toBeTruthy()
    expect(screen.getByText(/soins dispensés par les professions médicales et paramédicales \(art\. 261, 4, 1° du CGI\)/)).toBeTruthy()
    expect(bouton('Changer le statut')).toBeTruthy()
  })

  it('passer en franchise retire l’article dans la même écriture — la base refuserait l’article', async () => {
    const rendus = monter('exonere', 'cgi_261_4_1')
    fireEvent.click(bouton('Changer le statut'))
    fireEvent.click(bouton('Franchise en base (art. 293 B du CGI)'))
    // La franchise n'a pas d'article : la liste disparaît.
    expect(screen.queryAllByLabelText(/Article de l’exonération|Une partie de son activité/)).toHaveLength(0)
    expect(screen.getByText('Mention proposée sur ses factures : « TVA non applicable, art. 293 B du CGI. »')).toBeTruthy()
    await act(async () => { enregistrer().click() })
    expect(faux.ecritures[0].valeurs).toEqual({ statut_tva: 'franchise', article_exoneration: null })
    expect(rendus).toEqual([{ statut_tva: 'franchise', article_exoneration: null, assujetti_tva: false }])
  })

  it('un redevable peut porter l’article d’une activité en partie exonérée', async () => {
    const rendus = monter('redevable')
    fireEvent.click(bouton('Changer le statut'))
    fireEvent.change(screen.getByLabelText('Une partie de son activité est-elle exonérée ?'), { target: { value: 'cgi_261_c_2' } })
    await act(async () => { enregistrer().click() })
    expect(rendus).toEqual([{ statut_tva: 'redevable', article_exoneration: 'cgi_261_c_2', assujetti_tva: true }])
    expect(screen.getByText(/en partie exonéré : assurance et réassurance/)).toBeTruthy()
  })

  it('dit ce que le changement fait aux montants, dans les deux sens', () => {
    monter('exonere', 'cgi_261_4_1')
    fireEvent.click(bouton('Changer le statut'))
    fireEvent.click(bouton('Redevable de la TVA'))
    expect(screen.getByText(/ses pièces seront retenues hors taxes/)).toBeTruthy()
    cleanup()

    monter('redevable')
    fireEvent.click(bouton('Changer le statut'))
    fireEvent.click(bouton('Franchise en base (art. 293 B du CGI)'))
    expect(screen.getByText(/ses pièces seront retenues TVA comprise/)).toBeTruthy()
    // Garde symétrique : rester du même côté ne prévient de rien.
    fireEvent.click(bouton('Redevable de la TVA'))
    expect(screen.queryAllByText(/seront retenues/)).toHaveLength(0)
  })

  it('« Enregistrer » reste grisé tant que rien ne change, et « Annuler » rend le statut enregistré', () => {
    monter('redevable')
    fireEvent.click(bouton('Changer le statut'))
    expect(enregistrer()).toHaveProperty('disabled', true)
    fireEvent.click(bouton('Franchise en base (art. 293 B du CGI)'))
    expect(enregistrer()).toHaveProperty('disabled', false)
    fireEvent.click(bouton('Annuler'))
    expect(screen.getByText('Redevable de la TVA')).toBeTruthy()
    expect(faux.ecritures).toHaveLength(0)
  })

  it('un refus de la base se dit, l’édition reste ouverte, et un nouvel essai part', async () => {
    const rendus = monter(null)
    faux.refus = 'new row violates row-level security policy'
    fireEvent.click(bouton('Redevable de la TVA'))
    await act(async () => { enregistrer().click() })
    expect(screen.getByText('new row violates row-level security policy')).toBeTruthy()
    expect(rendus).toHaveLength(0)

    faux.refus = null
    await act(async () => { enregistrer().click() })
    expect(faux.ecritures).toHaveLength(2)
    expect(rendus).toEqual([{ statut_tva: 'redevable', article_exoneration: null, assujetti_tva: true }])
  })

  // TROIS CLICS DANS LE MÊME `act` : c'est ce qui distingue un verrou posé avant le `try` d'un verrou posé dedans.
  it('trois clics rapprochés n’écrivent qu’une fois', async () => {
    monter(null)
    fireEvent.click(bouton('Redevable de la TVA'))
    const reponse = retenue()
    faux.retenue = reponse.promesse
    const b = enregistrer()
    await act(async () => { b.click(); b.click(); b.click() })
    expect(faux.ecritures).toHaveLength(1)
    await act(async () => { reponse.relacher() })
  })
})

describe('FacturationElectroniqueCard — ce que le statut fait devoir au dossier', () => {
  const etats = () => [...document.querySelectorAll('.obligations-fe .badge')].map((b) => b.textContent)

  it('un dossier exonéré ne doit que la réception', () => {
    render(<FacturationElectroniqueCard statut="exonere" article="cgi_261_4_1" periodicite="trimestrielle" surDebits={false} />)
    expect(etats()).toEqual(['Due', 'Non due', 'Non due', 'Non due'])
    expect(screen.getByText(/^Réception des factures électroniques seulement/)).toBeTruthy()
    expect(screen.getAllByText(/Ses opérations exonérées \(art\. 261, 4, 1° du CGI\) en sortent\./)).toHaveLength(3)
  })

  it('un franchisé doit tout, tous les deux mois', () => {
    render(<FacturationElectroniqueCard statut="franchise" article={null} periodicite="trimestrielle" surDebits={false} />)
    expect(etats()).toEqual(['Due', 'Due', 'Due', 'Due'])
    expect(screen.getByText(/ses opérations avec l’étranger, tous les deux mois/)).toBeTruthy()
  })

  it('un statut à préciser ne promet rien d’autre que la réception', () => {
    render(<FacturationElectroniqueCard statut={null} article={null} periodicite="trimestrielle" surDebits={false} />)
    expect(etats()).toEqual(['Due', 'À préciser', 'À préciser', 'À préciser'])
  })

  it('un redevable en partie exonéré, sur option pour les débits', () => {
    render(<FacturationElectroniqueCard statut="redevable" article="cgi_261_4_1" periodicite="mensuelle" surDebits />)
    expect(etats()).toEqual(['Due', 'Due en partie', 'Due en partie', 'Non due'])
    expect(screen.getByText(/par décade/)).toBeTruthy()
  })
})
