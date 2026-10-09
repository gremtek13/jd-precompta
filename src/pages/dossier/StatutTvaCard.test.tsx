import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import StatutTvaCard, { FacturationElectroniqueCard, type ModificationStatutTva } from './StatutTvaCard'
import type { ArticleExoneration, StatutTva } from '../../lib/types'
import { SIRET_VENDEUR, TVA_VENDEUR } from '../../test/facturesCii'

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
          select: (colonnes: string) => ({
            single: () => {
              faux.ecritures.push({ table, valeurs, id })
              return (faux.retenue ?? Promise.resolve()).then(() => {
                if (faux.refus) return { data: null, error: { message: faux.refus } }
                // Le déclencheur `dossiers_deduire_assujetti_tva` : le booléen suit le statut. Et la base ne rend que
                // les colonnes demandées : une colonne oubliée dans le `select` arriverait absente à la page.
                const ligne: Record<string, unknown> = { ...valeurs, assujetti_tva: valeurs.statut_tva === 'redevable' }
                return { data: Object.fromEntries(colonnes.split(',').map((c) => c.trim()).map((c) => [c, ligne[c]])), error: null }
              })
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

interface Depart { statut: StatutTva | null; article: ArticleExoneration | null; numero: boolean; siret: string | null }

// Comme la page du dossier : ce que la base a écrit devient le statut que la carte reçoit.
function Hote({ depart, rendus }: { depart: Depart; rendus: ModificationStatutTva[] }) {
  const [tva, setTva] = useState(depart)
  return (
    <StatutTvaCard
      dossierId="d1"
      statut={tva.statut}
      article={tva.article}
      numeroTvaAttribue={tva.numero}
      siret={tva.siret}
      onStatutUpdated={(m) => {
        rendus.push(m)
        setTva({ ...tva, statut: m.statut_tva, article: m.article_exoneration, numero: m.numero_tva_attribue })
      }}
    />
  )
}

function monter(statut: StatutTva | null, article: ArticleExoneration | null = null, o: Partial<Pick<Depart, 'numero' | 'siret'>> = {}) {
  faux.ecritures = []
  faux.refus = null
  faux.retenue = null
  const rendus: ModificationStatutTva[] = []
  render(<Hote depart={{ statut, article, numero: false, siret: SIRET_VENDEUR, ...o }} rendus={rendus} />)
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
      table: 'dossiers', id: 'd1', valeurs: { statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1', numero_tva_attribue: false },
    }])
    expect(rendus).toEqual([{ statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1', assujetti_tva: false, numero_tva_attribue: false }])
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
    expect(faux.ecritures[0].valeurs).toEqual({ statut_tva: 'franchise', article_exoneration: null, numero_tva_attribue: false })
    expect(rendus).toEqual([{ statut_tva: 'franchise', article_exoneration: null, assujetti_tva: false, numero_tva_attribue: false }])
  })

  it('un redevable peut porter l’article d’une activité en partie exonérée', async () => {
    const rendus = monter('redevable')
    fireEvent.click(bouton('Changer le statut'))
    fireEvent.change(screen.getByLabelText('Une partie de son activité est-elle exonérée ?'), { target: { value: 'cgi_261_c_2' } })
    await act(async () => { enregistrer().click() })
    expect(rendus).toEqual([{ statut_tva: 'redevable', article_exoneration: 'cgi_261_c_2', assujetti_tva: true, numero_tva_attribue: false }])
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
    expect(rendus).toEqual([{ statut_tva: 'redevable', article_exoneration: null, assujetti_tva: true, numero_tva_attribue: false }])
  })

  // LA CASE DU NUMÉRO DE TVA (décision du cabinet du 08/10/2026) : elle ne se pose qu'en franchise ou exonéré, dit le
  // numéro qu'elle annonce avant le clic, et part dans la même écriture que le statut.
  it('un dossier en franchise coche son numéro de TVA : le numéro se lit avant le clic, puis la case s’enregistre', async () => {
    const rendus = monter('franchise')
    // En lecture : sans numéro, ce que cela coûte.
    expect(screen.getByText(/ses factures sans TVA restent imprimables et envoyables par e-mail, mais ne partent pas par une plateforme agréée \(règle G1\.47 de la DGFiP\)/)).toBeTruthy()
    fireEvent.click(bouton('Changer le statut'))
    const caseNumero = screen.getByLabelText('Le dossier a un numéro de TVA intracommunautaire, attribué par son service des impôts') as HTMLInputElement
    expect(caseNumero.checked).toBe(false)
    // La case seule est un changement : « Enregistrer » s'ouvre.
    expect(enregistrer()).toHaveProperty('disabled', true)
    fireEvent.click(caseNumero)
    expect(screen.getByText(`Son numéro, calculé de son SIREN : ${TVA_VENDEUR}.`)).toBeTruthy()
    expect(enregistrer()).toHaveProperty('disabled', false)
    expect(faux.ecritures).toHaveLength(0)

    await act(async () => { enregistrer().click() })
    expect(faux.ecritures[0].valeurs).toEqual({ statut_tva: 'franchise', article_exoneration: null, numero_tva_attribue: true })
    expect(rendus).toEqual([{ statut_tva: 'franchise', article_exoneration: null, assujetti_tva: false, numero_tva_attribue: true }])
    expect(screen.getByText(`Le dossier a un numéro de TVA intracommunautaire. Son numéro, calculé de son SIREN : ${TVA_VENDEUR}.`)).toBeTruthy()
  })

  it('devenu redevable, le dossier perd la case dans la même écriture — la base la refuserait', async () => {
    const rendus = monter('exonere', 'cgi_261_4_1', { numero: true })
    fireEvent.click(bouton('Changer le statut'))
    expect((screen.getByLabelText(/Le dossier a un numéro de TVA intracommunautaire/) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(bouton('Redevable de la TVA'))
    expect(screen.queryAllByLabelText(/Le dossier a un numéro de TVA intracommunautaire/)).toHaveLength(0)
    await act(async () => { enregistrer().click() })
    expect(faux.ecritures[0].valeurs).toEqual({ statut_tva: 'redevable', article_exoneration: 'cgi_261_4_1', numero_tva_attribue: false })
    expect(rendus[0].numero_tva_attribue).toBe(false)
    // Un redevable n'a pas la case : la lecture n'en parle pas.
    expect(screen.queryAllByText(/numéro de TVA intracommunautaire/)).toHaveLength(0)
  })

  it('un SIRET qui ne donne pas un SIREN valide : la case le dit, sans inventer de numéro', () => {
    monter('franchise', null, { numero: true, siret: '12345678900010' })
    expect(screen.getByText(/Le dossier a un numéro de TVA intracommunautaire\. Son SIRET, dans « Informations du dossier », ne donne pas un SIREN valide/)).toBeTruthy()
    expect(screen.queryAllByText(/calculé de son SIREN/)).toHaveLength(0)
  })

  it('la lecture dit la case d’un dossier exonéré, avec ou sans numéro', () => {
    monter('exonere', 'cgi_261_4_1', { numero: true })
    expect(screen.getByText(`Le dossier a un numéro de TVA intracommunautaire. Son numéro, calculé de son SIREN : ${TVA_VENDEUR}.`)).toBeTruthy()
    cleanup()
    monter('exonere', 'cgi_261_4_1')
    expect(screen.getByText(/ses factures sans TVA restent imprimables et envoyables par e-mail/)).toBeTruthy()
  })

  it('« Annuler » rend aussi la case enregistrée', () => {
    monter('franchise', null, { numero: true })
    fireEvent.click(bouton('Changer le statut'))
    fireEvent.click(screen.getByLabelText(/Le dossier a un numéro de TVA intracommunautaire/))
    expect(enregistrer()).toHaveProperty('disabled', false)
    fireEvent.click(bouton('Annuler'))
    fireEvent.click(bouton('Changer le statut'))
    expect((screen.getByLabelText(/Le dossier a un numéro de TVA intracommunautaire/) as HTMLInputElement).checked).toBe(true)
    expect(enregistrer()).toHaveProperty('disabled', true)
    expect(faux.ecritures).toHaveLength(0)
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

  // LE TEXTE FAUX NE REVIENT PAS (ligne 28.5, étape e1) : la carte disait d'un dossier exonéré « Réception des factures
  // électroniques seulement » et, sur trois lignes, « Il n'y est pas tenu » — faux pour ses achats à un fournisseur établi
  // hors de France (BOI-TVA-DECLA-20-30-50-10, §60), et pour ses opérations taxables s'il en a.
  it('un dossier exonéré : la réception, ses achats à l’étranger, et le reste le cas échéant', () => {
    render(<FacturationElectroniqueCard statut="exonere" article="cgi_261_4_1" periodicite="trimestrielle" surDebits={false} />)
    expect(etats()).toEqual(['Due', 'Le cas échéant', 'Le cas échéant', 'Due', 'Le cas échéant'])
    // « Le cas échéant » ne s'affiche pas comme une alerte : rien n'y est en défaut.
    expect(document.querySelectorAll('.obligations-fe .badge')[1].className).toContain('badge-neutral')
    expect(screen.getByText(/^Réception des factures électroniques depuis le 1er septembre 2026 ; au 1er septembre 2027, e-reporting de ses achats à l’étranger/)).toBeTruthy()
    expect(screen.getByText('Transmettre ses achats à l’étranger (e-reporting)')).toBeTruthy()
    expect(screen.getByText(/^Même exonéré, il y est tenu : ses achats à un fournisseur établi hors de France/)).toBeTruthy()
    expect(screen.getByText(/la redevance que lui verse un collaborateur, par exemple/)).toBeTruthy()
    expect(screen.getAllByText(/Ses opérations exonérées \(art\. 261, 4, 1° du CGI\) en sortent\./)).toHaveLength(3)
    expect(screen.queryAllByText(/n’y est pas tenu|électroniques seulement|^Non due$/)).toHaveLength(0)
  })

  it('un franchisé doit tout, tous les deux mois, et ses achats à l’étranger lui demandent un numéro de TVA', () => {
    render(<FacturationElectroniqueCard statut="franchise" article={null} periodicite="trimestrielle" surDebits={false} />)
    expect(etats()).toEqual(['Due', 'Due', 'Due', 'Due', 'Due'])
    expect(screen.getByText(/^Ses ventes à des particuliers et à des clients établis hors de France, tous les deux mois\./)).toBeTruthy()
    expect(screen.getByText(/tous les deux mois\. Il lui faut alors un numéro de TVA intracommunautaire\./)).toBeTruthy()
  })

  it('un statut à préciser promet la réception et les achats à l’étranger', () => {
    render(<FacturationElectroniqueCard statut={null} article={null} periodicite="trimestrielle" surDebits={false} />)
    expect(etats()).toEqual(['Due', 'À préciser', 'À préciser', 'Due', 'À préciser'])
    expect(screen.getByText(/quel que soit son statut de TVA ; leur fréquence en dépend/)).toBeTruthy()
  })

  it('un redevable en partie exonéré, sur option pour les débits', () => {
    render(<FacturationElectroniqueCard statut="redevable" article="cgi_261_4_1" periodicite="mensuelle" surDebits />)
    expect(etats()).toEqual(['Due', 'Due en partie', 'Due en partie', 'Due', 'Non due'])
    // Ses ventes et ses achats, par décade.
    expect(screen.getAllByText(/par décade/)).toHaveLength(2)
  })
})
