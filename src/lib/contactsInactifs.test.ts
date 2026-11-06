import { describe, expect, it } from 'vitest'
import { ajouterAnnees, contactsSansActivite, phraseDuContactSansActivite, type ActiviteDUnContact } from './contactsInactifs'
import { contact } from '../test/contacts'

// LA RÈGLE DES CLIENTS SANS ACTIVITÉ DEPUIS TROIS ANS (lib/contactsInactifs.ts). Ce que ces cas gardent : le jour de PARIS de
// « maintenant » (passé par l'appelant), trois ans CALENDAIRES — la veille non, le jour même et le lendemain oui —, le
// 29 février jamais un jour plus tôt, la plus récente des factures et des devis cités, la création du contact (au jour de
// Paris d'un instant) quand rien ne le cite, un contact effacé jamais proposé, un retiré proposé, un ordre total.

const ids = (l: { contact: { id: string } }[]) => l.map((x) => x.contact.id)
// Midi à Paris, en hiver (UTC+1) : loin de minuit, le jour ne dépend d'aucun fuseau de la machine.
const midi = (jour: string) => new Date(`${jour}T11:00:00Z`)

describe('ajouterAnnees', () => {
  it('trois ans calendaires, et un 29 février qui passe au 1er mars', () => {
    expect(ajouterAnnees('2023-11-06', 3)).toBe('2026-11-06')
    expect(ajouterAnnees('2024-02-29', 3)).toBe('2027-03-01')
    expect(ajouterAnnees('2024-02-29', 4)).toBe('2028-02-29')
    expect(ajouterAnnees('2023-12-31', 3)).toBe('2026-12-31')
    expect(() => ajouterAnnees('06/11/2023', 3)).toThrow()
  })
})

describe('contactsSansActivite', () => {
  const k = contact({ id: 'k', nom: 'Client K', cree_le: '2020-01-15T09:00:00Z' })
  const derniere: ActiviteDUnContact[] = [
    { contactId: 'k', date: '2022-05-01' }, { contactId: 'k', date: '2023-11-06' }, { contactId: 'k', date: '2021-01-01' },
  ]

  it('J−1 : pas encore ; J et J+1 : proposé, depuis la plus récente de ses factures et de ses devis', () => {
    expect(contactsSansActivite([k], derniere, midi('2026-11-05'))).toEqual([])
    const j = contactsSansActivite([k], derniere, midi('2026-11-06'))
    expect(j).toEqual([{ contact: k, depuis: '2023-11-06', origine: 'activite', proposeLe: '2026-11-06' }])
    expect(ids(contactsSansActivite([k], derniere, midi('2026-11-07')))).toEqual(['k'])
  })

  it('le jour de Paris, jamais celui de la machine ni d’UTC : 23 h 30 UTC le 5 est déjà le 6 à Paris', () => {
    expect(ids(contactsSansActivite([k], derniere, new Date('2026-11-05T23:30:00Z')))).toEqual(['k'])
    expect(ids(contactsSansActivite([k], derniere, new Date('2026-11-05T22:59:59Z')))).toEqual([])
    // En été (UTC+2) : 22 h 30 UTC le 5 juillet est le 6 à Paris.
    const ete = [{ contactId: 'k', date: '2023-07-06' }]
    expect(ids(contactsSansActivite([k], ete, new Date('2026-07-05T22:30:00Z')))).toEqual(['k'])
    expect(ids(contactsSansActivite([k], ete, new Date('2026-07-05T21:59:59Z')))).toEqual([])
  })

  it('une activité récente — une facture OU un devis — retient le contact', () => {
    const recente = [...derniere, { contactId: 'k', date: '2025-03-01' }]
    expect(contactsSansActivite([k], recente, midi('2027-01-01'))).toEqual([])
    expect(ids(contactsSansActivite([k], recente, midi('2028-03-01')))).toEqual(['k'])
  })

  it('sans facture ni devis, le compte part de la création, au jour de Paris de l’instant', () => {
    // 23 h 30 UTC le 6 novembre 2023 : le 7 à Paris.
    const neuf = contact({ id: 'n', nom: 'Client N', cree_le: '2023-11-06T23:30:00Z' })
    expect(contactsSansActivite([neuf], [], midi('2026-11-06'))).toEqual([])
    expect(contactsSansActivite([neuf], [], midi('2026-11-07'))).toEqual([
      { contact: neuf, depuis: '2023-11-07', origine: 'creation', proposeLe: '2026-11-07' },
    ])
    // L'activité d'un AUTRE contact ne compte pas pour lui.
    expect(ids(contactsSansActivite([neuf], [{ contactId: 'k', date: '2026-11-01' }], midi('2026-11-07')))).toEqual(['n'])
  })

  it('un contact effacé n’est jamais proposé ; un retiré l’est', () => {
    const efface = contact({ id: 'e', nom: 'Contact effacé le 01/01/2020', cree_le: '2019-01-01T09:00:00Z', efface_le: '2020-01-01T09:00:00Z', efface_par: 'u' })
    const retire = contact({ id: 'r', nom: 'Retiré', cree_le: '2019-01-01T09:00:00Z', retire_le: '2020-01-01T09:00:00Z', retire_par: 'u' })
    expect(ids(contactsSansActivite([efface, retire], [], midi('2026-11-06')))).toEqual(['r'])
  })

  it('un ordre total : le plus ancien d’abord, puis le nom, puis l’identifiant', () => {
    const a = contact({ id: 'b2', nom: 'Même', cree_le: '2020-01-01T09:00:00Z' })
    const b = contact({ id: 'b1', nom: 'Même', cree_le: '2020-01-01T09:00:00Z' })
    const c = contact({ id: 'a', nom: 'Zèbre', cree_le: '2019-06-01T09:00:00Z' })
    expect(ids(contactsSansActivite([a, b, c], [], midi('2026-11-06')))).toEqual(['a', 'b1', 'b2'])
  })

  it('une date d’émission illisible lève, jamais une activité ignorée', () => {
    expect(() => contactsSansActivite([k], [{ contactId: 'k', date: '' }], midi('2026-11-06'))).toThrow()
  })

  it('la phrase dit d’où part le compte', () => {
    const [p] = contactsSansActivite([k], derniere, midi('2026-11-06'))
    expect(phraseDuContactSansActivite(p, (d) => d)).toBe('dernière facture ou dernier devis le 2023-11-06')
  })
})
