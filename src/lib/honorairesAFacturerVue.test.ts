import { describe, expect, it } from 'vitest'
import type { FactureDuCabinet, LettreAFacturer, LienDHonoraires, LigneDHonoraires } from './honorairesAFacturer'
import {
  aFacturerParClient, confirmationDeLaFacturation, libelleDuTaux, motsDeLaFacturee, motsDuProrata, refusDeLaSelection, type ElementPropose,
} from './honorairesAFacturerVue'

// « À FACTURER », CE QUE LA CARTE MONTRE (ligne 47, LM7) : par client puis par lettre acceptée, les forfaits échus et les
// tâches par exercice, que la base accepterait ; ce qui est déjà facturé, avec sa facture ; la période qu'un avoir total a
// rendue à facturer (un avoir partiel la laisse facturée) ; le refus avant le clic, aux mots du module ; la confirmation
// qui nomme le client, les périodes et le hors taxes. Données FICTIVES.

const H: LigneDHonoraires[] = [
  { forme: 'forfait', libelle: 'Tenue mensuelle', montant_ht: 150, periodicite: 'mois' },
  { forme: 'tache', libelle: 'Déclaration 2035', montant_ht: 600, livrable: 'declaration_2035' },
  { forme: 'temps', libelle: 'Conseil au temps passé', montant_ht: 90 },
]
const lettre = (id: string, fin: Partial<LettreAFacturer> = {}): LettreAFacturer => ({
  id, remplace_id: null, dossier_client_id: 'C', date_effet: '2026-08-01', fin_initiale: '2026-12-31', reconduction_tacite: true,
  proposee_le: '2026-07-01', acceptee_le: '2026-07-05', refusee_le: null, retiree_le: null, fin_au: null,
  honoraires: H, premier_exercice: 2025, ...fin,
})
const facture = (id: string, montant: number, fin: Partial<FactureDuCabinet> = {}): FactureDuCabinet =>
  ({ id, type: 'facture', statut: 'validee', montant_ttc: montant, facture_origine_id: null, numero: `F-${id}`, ...fin })
const avoir = (id: string, origine: string, montant: number): FactureDuCabinet =>
  ({ id, type: 'avoir', statut: 'validee', montant_ttc: -montant, facture_origine_id: origine, numero: `A-${id}` })
const lien = (facture_id: string, lettre_id: string, ligne: number, debut: string, fin: string): LienDHonoraires =>
  ({ facture_id, lettre_id, ligne, periode_debut: debut, periode_fin: fin, facturation: 1 })
const AUJOURDHUI = '2026-11-11'
const dossiers = [{ id: 'C', nom: 'Client fictif' }, { id: 'D', nom: 'Autre client fictif' }]
const voir = (lettres: LettreAFacturer[], liens: LienDHonoraires[] = [], factures: FactureDuCabinet[] = []) =>
  aFacturerParClient({ lettres, liens, factures, avoirsRepris: [], dossiers, aujourdhui: AUJOURDHUI })

describe('ce qui se facture', () => {
  it('les forfaits échus (pas le mois en cours) et les tâches par exercice, depuis le premier exercice ; jamais le temps passé', () => {
    const [client] = voir([lettre('L')])
    expect(client.nomDuClient).toBe('Client fictif')
    const designations = client.lettres[0].elements.map((e) => `${e.forme}:${e.designation}`)
    expect(designations).toEqual([
      'forfait:Tenue mensuelle — août 2026', 'forfait:Tenue mensuelle — septembre 2026', 'forfait:Tenue mensuelle — octobre 2026',
      'tache:Déclaration 2035 — exercice 2025', 'tache:Déclaration 2035 — exercice 2026',
    ])
  })

  it('range par client, dans l’ordre des noms ; une lettre non acceptée ne propose rien', () => {
    const clients = voir([lettre('L'), lettre('M', { dossier_client_id: 'D' }), lettre('P', { dossier_client_id: 'D', acceptee_le: null })])
    expect(clients.map((c) => c.nomDuClient)).toEqual(['Autre client fictif', 'Client fictif'])
    expect(clients[0].lettres.map((l) => l.lettre.id)).toEqual(['M'])
  })

  it('une tâche ne se propose que sous la version en vigueur au dernier jour de l’exercice', () => {
    const taches = (lettres: LettreAFacturer[]) => voir(lettres)[0].lettres
      .flatMap((l) => l.elements.filter((e) => e.forme === 'tache').map((e) => `${l.lettre.id}:${e.periode_debut}`))
    // 2025 : aucune version n'est en vigueur au 31/12/2025 ; la base accepte celle du jour du clic, l'avenant seul.
    // 2026 : l'avenant, en vigueur au 31/12/2026.
    const avenant = lettre('LB', { remplace_id: 'L', date_effet: '2026-10-01', acceptee_le: '2026-09-20' })
    expect(taches([lettre('L'), avenant])).toEqual(['LB:2025-01-01', 'LB:2026-01-01'])
    // Une première version en vigueur au 31/12/2025 : la base accepterait 2025 sous les deux (l'avenant, au jour du clic) ;
    // la carte ne le propose que sous celle du 31/12.
    const ancienne = lettre('L', { date_effet: '2025-01-01' })
    expect(taches([ancienne, avenant])).toEqual(['L:2025-01-01', 'LB:2026-01-01'])
  })
})

describe('ce qui est déjà facturé, et l’avoir', () => {
  it('une période facturée sort des propositions et se dit avec sa facture', () => {
    const [client] = voir([lettre('L')], [lien('F1', 'L', 1, '2026-08-01', '2026-08-31')], [facture('F1', 180)])
    const { elements, facturees } = client.lettres[0]
    expect(elements.some((e) => e.periode_debut === '2026-08-01' && e.forme === 'forfait')).toBe(false)
    expect(facturees).toHaveLength(1)
    expect(motsDeLaFacturee(facturees[0])).toBe('Facturée par la facture F-F1')
  })

  it('un avoir partiel la laisse facturée ; un avoir total la rend à facturer, et le dit', () => {
    const liens = [lien('F1', 'L', 1, '2026-08-01', '2026-08-31')]
    const aout = (factures: FactureDuCabinet[]) => voir([lettre('L')], liens, factures)[0].lettres[0]
    expect(aout([facture('F1', 180), avoir('A1', 'F1', 50)]).elements.some((e) => e.periode_debut === '2026-08-01')).toBe(false)
    const rendue = aout([facture('F1', 180), avoir('A1', 'F1', 180)])
    expect(rendue.elements.find((e) => e.periode_debut === '2026-08-01')?.rendueParLAvoirDe).toBe('F-F1')
    expect(motsDeLaFacturee(rendue.facturees[0])).toBe('Facturée par la facture F-F1, créditée en entier par un avoir : à facturer de nouveau')
  })

  it('un brouillon couvre sa période et se dit brouillon', () => {
    const [client] = voir([lettre('L')], [lien('F1', 'L', 1, '2026-08-01', '2026-08-31')], [facture('F1', 180, { statut: 'brouillon', numero: null })])
    expect(motsDeLaFacturee(client.lettres[0].facturees[0])).toBe('Facturée par un brouillon de facture')
  })
})

describe('avant le clic', () => {
  const lettres = [lettre('L'), lettre('M', { dossier_client_id: 'D' })]
  const [autre, client] = voir(lettres)
  const aout = client.lettres[0].elements[0]
  it('dit le taux à choisir, une sélection vide, deux clients, une période déjà facturée — aux mots du module', () => {
    expect(refusDeLaSelection([aout], lettres, [], [], [], null, AUJOURDHUI)).toContain('Le taux de TVA des honoraires est de 20 %')
    expect(refusDeLaSelection([], lettres, [], [], [], 20, AUJOURDHUI)).toBe('Coche au moins une période ou une tâche à facturer.')
    expect(refusDeLaSelection([aout, autre.lettres[0].elements[0]], lettres, [], [], [], 20, AUJOURDHUI))
      .toBe('Une facture d’honoraires s’adresse à un seul client.')
    expect(refusDeLaSelection([aout], lettres, [lien('F1', 'L', 1, '2026-08-01', '2026-08-31')], [facture('F1', 180)], [], 20, AUJOURDHUI))
      .toBe('Tenue mensuelle — août 2026 : Cette période est déjà facturée : une facture qui n’est pas créditée en entier la couvre.')
    expect(refusDeLaSelection([aout], lettres, [], [], [], 8.5, AUJOURDHUI)).toBeNull()
  })

  it('une lettre d’effet au 15 janvier : janvier au prorata de ses jours, dit « 17 jours sur 31 » (LM7-Q4 (C))', () => {
    const [c] = voir([lettre('L', { date_effet: '2026-01-15' })])
    const janvier = c.lettres[0].elements.find((e) => e.periode_debut === '2026-01-15') as ElementPropose
    expect(janvier).toMatchObject({ forme: 'forfait', periode_fin: '2026-01-31', montant_ht: 82.26, prorata: { jours: 17, sur: 31, prixDeLaPeriode: 150 } })
    expect(motsDuProrata(janvier).replace(/[\u00a0\u202f]/g, ' ')).toBe('17 jours sur 31 du forfait de 150,00 € HT')
    expect(motsDuProrata(c.lettres[0].elements.find((e) => e.periode_debut === '2026-02-01') as ElementPropose)).toBe('')
    expect(c.lettres[0].elements.find((e) => e.forme === 'tache')?.prorata).toBeNull()
    const texte = confirmationDeLaFacturation('Client fictif', [janvier], 20).replace(/[\u00a0\u202f]/g, ' ')
    expect(texte).toContain('Tenue mensuelle — janvier 2026, du 15/01/2026 au 31/01/2026 (17 jours sur 31) : 82,26 € HT (au prorata du forfait de 150,00 € HT)')
    expect(texte).toContain('Un forfait que sa lettre commence ou finit en cours de période se facture au prorata de ses jours, arrondi au centime.')
  })

  it('la confirmation nomme le client, chaque période et le hors taxes, et dit qu’une tâche cochée est faite', () => {
    const tache = client.lettres[0].elements.find((e) => e.forme === 'tache') as ElementPropose
    const texte = confirmationDeLaFacturation('Client fictif', [aout, tache], 20).replace(/ | /g, ' ')
    expect(texte).toContain('« Client fictif »')
    expect(texte).toContain('Tenue mensuelle — août 2026 : 150,00 € HT')
    expect(texte).toContain('Déclaration 2035 — exercice 2025 : 600,00 € HT')
    expect(texte).toContain('Total : 750,00 € HT, TVA à 20 % : 150,00 €, soit 900,00 € TTC.')
    expect(texte).toContain('Facturer une tâche la dit faite.')
    expect(libelleDuTaux(8.5)).toBe('8,5 % (Guadeloupe, Martinique, La Réunion)')
  })
})
