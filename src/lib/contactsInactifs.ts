import { dateAParis } from './format'
import type { Contact } from './types'

// LES CLIENTS SANS ACTIVITÉ DEPUIS TROIS ANS (la durée du fichier des clients, RGPD.md §2 : « la relation, puis trois ans sans
// facture ni devis » — proposé à l'effacement, JAMAIS effacé seul). Une LISTE : l'effacement reste le geste de la vue
// « Clients », confirmé, un contact à la fois.
//
// La règle, sur des valeurs passées par l'appelant (aucune lecture ici, et « maintenant » jamais lu au chargement) :
//   - l'activité d'un contact, ce sont les factures et les devis qui le CITENT (`contact_id`, une provenance tenue en base,
//     jamais un nom ni un SIRET rapprochés) — un brouillon, une facture validée, un avoir, un devis émis ou non : chacun à sa
//     date d'émission ;
//   - sans aucune facture ni aucun devis cité, le compte part de la création du contact (`cree_le`, un INSTANT, pris au jour
//     de Paris) : la relation commence là ;
//   - trois ans CALENDAIRES : la dernière activité du 6 novembre 2023 rend le contact proposé le 6 novembre 2026, au jour de
//     Paris, pas la veille ; un 29 février compte jusqu'au 1er mars (jamais un jour plus tôt que trois ans pleins) ;
//   - un contact effacé n'est jamais proposé (il l'est déjà) ; un contact retiré l'est (retiré n'est pas effacé).

export const ANNEES_SANS_ACTIVITE = 3

/** Une facture ou un devis qui cite un contact : sa date d'émission, civile (AAAA-MM-JJ). */
export interface ActiviteDUnContact {
  contactId: string
  date: string
}

export interface ContactSansActivite {
  contact: Contact
  /** La date d'où part le compte : la dernière facture ou le dernier devis, ou la création du contact. */
  depuis: string
  /** D'où elle vient. */
  origine: 'activite' | 'creation'
  /** Le jour (de Paris) où les trois ans sont accomplis : le contact est proposé depuis ce jour-là. */
  proposeLe: string
}

const UN_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/

/** La date civile `n` années plus tard ; un jour qui n'existe pas cette année-là (le 29 février) passe au lendemain. */
export function ajouterAnnees(date: string, n: number): string {
  const m = UN_JOUR.exec(date)
  if (!m) throw new Error(`date civile illisible : ${date}`)
  const annee = Number(m[1]) + n
  const mois = Number(m[2])
  const jour = Number(m[3])
  const dernierDuMois = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  if (jour > dernierDuMois) return `${String(annee).padStart(4, '0')}-${String(mois + 1).padStart(2, '0')}-01`
  return `${String(annee).padStart(4, '0')}-${m[2]}-${m[3]}`
}

/**
 * Les contacts sans facture ni devis depuis trois ans au jour de Paris de `maintenant`, du plus ancien au plus récent (puis
 * par nom, puis par identifiant : un ordre total). `contacts` : la liste du dossier lue EN ENTIER ; `activites` : toutes les
 * factures et tous les devis du dossier qui citent un contact, lus EN ENTIER — l'appelant ne l'appelle pas autrement.
 */
export function contactsSansActivite(
  contacts: readonly Contact[],
  activites: readonly ActiviteDUnContact[],
  maintenant: Date,
): ContactSansActivite[] {
  const aujourdHui = dateAParis(maintenant)
  const derniere = new Map<string, string>()
  for (const a of activites) {
    if (!UN_JOUR.test(a.date)) throw new Error(`date d'émission illisible : ${a.date}`)
    const vue = derniere.get(a.contactId)
    if (vue === undefined || a.date > vue) derniere.set(a.contactId, a.date)
  }
  const proposes: ContactSansActivite[] = []
  for (const contact of contacts) {
    if (contact.efface_le != null) continue
    const activite = derniere.get(contact.id)
    const depuis = activite ?? dateAParis(contact.cree_le)
    const proposeLe = ajouterAnnees(depuis, ANNEES_SANS_ACTIVITE)
    if (aujourdHui >= proposeLe) {
      proposes.push({ contact, depuis, origine: activite === undefined ? 'creation' : 'activite', proposeLe })
    }
  }
  return proposes.sort((a, b) => (a.depuis < b.depuis ? -1 : a.depuis > b.depuis ? 1
    : a.contact.nom < b.contact.nom ? -1 : a.contact.nom > b.contact.nom ? 1
      : a.contact.id < b.contact.id ? -1 : a.contact.id > b.contact.id ? 1 : 0))
}

/** Ce que la liste dit d'un contact proposé, aux mots de l'espace. */
export function phraseDuContactSansActivite(c: ContactSansActivite, formatDate: (d: string) => string): string {
  return c.origine === 'activite'
    ? `dernière facture ou dernier devis le ${formatDate(c.depuis)}`
    : `aucune facture ni aucun devis depuis sa création, le ${formatDate(c.depuis)}`
}
