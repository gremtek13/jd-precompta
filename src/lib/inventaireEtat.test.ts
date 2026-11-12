import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'
import type { ComptesDInventaire, EcritureDInventaire } from './inventaire'
import { euros, type DonneesDeLInventaire, type LigneDuBrouillonDInventaire } from './inventaireEcran'
import { blocsDeLEtat, csvDeLEtat, etatDInventaire, nomDuFichierDeLEtat, pdfDeLEtat } from './inventaireEtat'
import type { InventaireDeclare, OperationInventaire, Provision } from './types'

// L'ÉTAT D'INVENTAIRE (ligne 35, INV5 ; lib/inventaireEtat.ts). Ce que ces cas gardent : une ligne par régularisation puis une par
// provision, son calcul dit (HT + TVA d'attente, jours après la clôture, cible moins précédente), sa justification, sa date de
// saisie au jour de Paris ; la déclaration dite ; un CSV à BOM UTF-8, point-virgule et `champCsv` ; un vrai PDF, daté du dernier
// geste de l'état (deux tirages, mêmes octets) ; un nom de fichier sans accent. Des jeux FICTIFS.

const COMPTES: ComptesDInventaire = {}

const operation = (p: Partial<OperationInventaire> & Pick<OperationInventaire, 'id'>): OperationInventaire => ({
  dossier_id: 'd1', exercice: 2025, nature: 'cca', compte_resultat: '616000', compte_regularisation: '486100', montant_centimes: 60_000,
  tva_centimes: 0, periode_debut: null, periode_fin: null, objet: 'Assurance du local', piece_citee_id: null, provision_id: null, version: 1,
  cree_par: 'u', cree_le: '2026-11-10T09:00:00Z', modifie_par: null, modifie_le: null, ...p,
})

const provision = (p: Partial<Provision> & Pick<Provision, 'id'>): Provision => ({
  dossier_id: 'd1', genre: 'risque', compte_provision: '151110', objet: 'Litige avec un fournisseur', facture_id: null, piece_citee_id: null,
  ouverte_en: 2025, reprise_centimes: null, version: 1, cree_par: 'u', cree_le: '2026-11-10T09:00:00Z', modifie_par: null, modifie_le: null, ...p,
})

const declaration = (p: Partial<InventaireDeclare> = {}): InventaireDeclare => ({
  id: 'i1', dossier_id: 'd1', exercice: 2025, declare_par: 'u', declare_le: '2026-11-11T23:30:00Z', retire_par: null, retire_le: null, ...p,
})

const lignesDe = (id: string, e: EcritureDInventaire): LigneDuBrouillonDInventaire[] =>
  e.lignes.map((l) => ({ date: e.date, compte: l.compte, sens: l.sens, montant: l.centimes / 100, operation_inventaire_id: id }))

const cca = operation({ id: 'o1', periode_debut: '2025-07-01', periode_fin: '2026-06-30', objet: 'Assurance du local; « multirisque »' })
const fnp = operation({ id: 'o2', nature: 'fnp', compte_resultat: '622000', compte_regularisation: '408110', montant_centimes: 100_000, tva_centimes: 20_000, objet: 'Honoraires de décembre', piece_citee_id: 'pc1' })
const p1 = provision({ id: 'p1' })
const eval25 = operation({ id: 'e25', nature: 'provision', provision_id: 'p1', montant_centimes: 300_000, compte_resultat: '781510', compte_regularisation: '151110', objet: p1.objet })
const eval24 = operation({ id: 'e24', exercice: 2024, nature: 'provision', provision_id: 'p1', montant_centimes: 500_000, compte_resultat: '681510', compte_regularisation: '151110', objet: p1.objet })
const p2 = provision({ id: 'p2', genre: 'depreciation_creance', compte_provision: '491100', objet: 'Créance du client X' })

const ECRITURES_CCA: LigneDuBrouillonDInventaire[] = [
  { date: '2025-12-31', compte: '486100', sens: 'debit', montant: 600, operation_inventaire_id: 'o1' },
  { date: '2025-12-31', compte: '616000', sens: 'credit', montant: 600, operation_inventaire_id: 'o1' },
  { date: '2026-01-01', compte: '486100', sens: 'credit', montant: 600, operation_inventaire_id: 'o1' },
  { date: '2026-01-01', compte: '616000', sens: 'debit', montant: 600, operation_inventaire_id: 'o1' },
]

const donnees = (p: Partial<DonneesDeLInventaire> = {}): DonneesDeLInventaire => ({
  operations: [cca, fnp, eval24, eval25], provisions: [p1, p2], declarations: [declaration()], lignes: ECRITURES_CCA, comptes: COMPTES, premierExercice: 2024, ...p,
})

describe('l’état d’un exercice', () => {
  const etat = etatDInventaire(donnees(), 2025, 'Cabinet Dupont — société fictive')

  it('une ligne par régularisation, puis une par provision de l’exercice, et la déclaration dite au jour de Paris', () => {
    expect(etat.lignes.map((l) => l.nature)).toEqual(['Charge constatée d’avance', 'Facture non parvenue', 'Provision pour risques', 'Dépréciation de créance'])
    // 23 h 30 UTC le 11/11 : minuit passé à Paris (UTC+1), le 12/11.
    expect(etat.declareLe).toBe('12/11/2026')
    expect(etat.exercice).toBe(2025)
  })

  it('dit le calcul de chaque ligne : les jours après la clôture, le HT et la TVA d’attente, la cible moins la précédente', () => {
    const [ligneCca, ligneFnp, ligneProvision] = etat.lignes
    expect(ligneCca.calcul).toContain('Période de 365 jour(s), dont 181 après le 31/12/2025 (jours réels)')
    expect(ligneCca.calcul).toContain(euros(60_000))
    expect(ligneCca.periode).toBe('du 01/07/2025 au 30/06/2026')
    expect(ligneFnp.calcul).toBe(`Hors taxes ${euros(100_000)} + TVA d’attente ${euros(20_000)} = ${euros(120_000)} au compte de tiers.`)
    expect(ligneProvision.calcul).toBe(`Cible au 31/12/2025 ${euros(300_000)} − provision au 31/12/2024 ${euros(500_000)} = reprise de ${euros(200_000)}.`)
    expect(ligneProvision.ecritures).toBe('31/12/2025 (reprise, sans extourne)')
  })

  it('dit la justification et si une pièce du dossier fonde la ligne, jamais un nom de personne', () => {
    expect(etat.lignes[0].justification).toBe('Régularisation saisie par le cabinet : Assurance du local; « multirisque ».')
    expect(etat.lignes[1].justification).toContain('Une pièce du dossier la fonde.')
    expect(JSON.stringify(etat)).not.toContain('"u"')
  })

  it('une provision non évaluée sur l’exercice le dit ; une provision soldée aussi', () => {
    const non = etat.lignes[3]
    expect(non.montantCentimes).toBeNull()
    expect(non.calcul).toContain('non évaluée sur cet exercice')
    const soldee = etatDInventaire(donnees({ operations: [operation({ id: 's', exercice: 2024, nature: 'provision', provision_id: 'p2', montant_centimes: 0 })] }), 2025, 'X')
    expect(soldee.lignes.find((l) => l.objet === p2.objet)?.calcul).toBe('Soldée au 31/12/2024 : elle ne s’évalue plus.')
  })

  it('dit si les écritures sont à jour : celles du brouillon sont la paire commandée, ou non', () => {
    expect(etat.lignes[0].aJour).toBe(true)
    // L'opération fnp n'a aucune ligne au brouillon : elle est à recomposer.
    expect(etat.lignes[1].aJour).toBe(false)
  })

  it('une ligne par opération de l’exercice seulement : l’évaluation de l’an dernier n’y est pas', () => {
    expect(etat.lignes.map((l) => l.objet)).not.toContain('Autre exercice')
    expect(etat.lignes).toHaveLength(4)
  })

  it('l’instant du document est le dernier geste de l’état (une saisie, la déclaration), jamais l’heure du tirage', () => {
    expect(etat.instant).toBe('2026-11-11T23:30:00.000Z')
    const plusTard = etatDInventaire(donnees({ operations: [{ ...cca, modifie_le: '2026-11-13T08:00:00Z' }, fnp, eval24, eval25] }), 2025, 'X')
    expect(plusTard.instant).toBe('2026-11-13T08:00:00.000Z')
    const vide = etatDInventaire(donnees({ operations: [], provisions: [], declarations: [], lignes: [] }), 2025, 'X')
    expect(vide.instant).toBe('2026-01-01T00:00:00.000Z')
    expect(vide.declareLe).toBeNull()
    expect(vide.lignes).toEqual([])
  })
})

describe('le CSV de l’état', () => {
  const csv = csvDeLEtat(etatDInventaire(donnees(), 2025, 'Cabinet Dupont'))
  const lignes = csv.split('\r\n')

  it('porte un BOM UTF-8, le point-virgule, un en-tête et une ligne par ligne de l’état', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(lignes).toHaveLength(5)
    expect(lignes[0]).toBe('﻿Exercice;Nature;Objet;Compte de charge ou de produit;Compte de régularisation;Montant;TVA d’attente;Période;Écritures;Calcul;Justification;Saisie le;Écritures à jour')
  })

  it('met chaque champ par champCsv : un point-virgule ou un guillemet se protège, le montant a sa virgule décimale', () => {
    expect(lignes[1]).toContain('"Assurance du local; « multirisque »"')
    const lues = parseCsv(csv.slice(1))
    expect(lues).toHaveLength(5)
    expect(lues[1][2]).toBe('Assurance du local; « multirisque »')
    expect(lues[1][5]).toBe('600,00')
    expect(lues[2].slice(5, 7)).toEqual(['1000,00', '200,00'])
    // Une provision non évaluée : un montant vide, sans symbole.
    expect(lues[4].slice(4, 7)).toEqual(['491100', '', ''])
  })

  it('un tableur relit des montants sans symbole d’euro ni espace insécable', () => {
    for (const l of parseCsv(csv.slice(1)).slice(1)) for (const colonne of [5, 6]) expect(l[colonne]).toMatch(/^(\d+,\d{2})?$/)
  })
})

describe('le PDF de l’état', () => {
  const etat = etatDInventaire(donnees(), 2025, 'Cabinet Dupont')

  it('les blocs : le titre, le dossier et la pièce, la déclaration, une intertitre par nature, les mentions', () => {
    const blocs = blocsDeLEtat(etat)
    expect(blocs[0]).toEqual({ genre: 'titre', texte: 'État d’inventaire 2025' })
    expect(blocs[1].texte).toContain('« Inventaire 2025 »')
    expect(blocs[2].texte).toBe('Inventaire déclaré fait le 12/11/2026.')
    expect(blocs.filter((b) => b.genre === 'intertitre').map((b) => b.texte)).toEqual(['Charge constatée d’avance', 'Facture non parvenue', 'Provision pour risques', 'Dépréciation de créance'])
    expect(blocs.map((b) => b.texte).join('\n')).toContain('Attention : les écritures de cette ligne ne sont plus celles qu’elle commande')
    expect(blocs.at(-1)?.genre).toBe('mention')
    const vide = blocsDeLEtat(etatDInventaire(donnees({ operations: [], provisions: [], declarations: [], lignes: [] }), 2025, 'X'))
    expect(vide[2].texte).toBe('L’inventaire de cet exercice n’est pas déclaré à ce jour.')
    expect(vide.map((b) => b.texte)).toContain('Aucune régularisation ni provision sur cet exercice.')
  })

  it('tire un vrai PDF, et deux tirages du même état rendent les mêmes octets', async () => {
    const a = await pdfDeLEtat(etat)
    const b = await pdfDeLEtat(etat)
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe('%PDF-')
    expect(a.length).toBeGreaterThan(1500)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('porte des caractères hors WinAnsi sans lever (le PDF dit « ? » plutôt que de tomber)', async () => {
    const e = etatDInventaire(donnees({ operations: [operation({ id: 'z', objet: 'Assurance ✓ « local » ≠' })] }), 2025, 'Dossier ✓')
    expect((await pdfDeLEtat(e)).length).toBeGreaterThan(500)
  })
})

describe('le nom d’un fichier', () => {
  it('l’exercice et le dossier, sans accent ni signe', () => {
    expect(nomDuFichierDeLEtat({ exercice: 2025, dossierNom: 'Société Étoile & Fils (SARL)' }, 'pdf')).toBe('inventaire-2025-societe-etoile-fils-sarl.pdf')
    expect(nomDuFichierDeLEtat({ exercice: 2025, dossierNom: '' }, 'csv')).toBe('inventaire-2025.csv')
    expect(nomDuFichierDeLEtat({ exercice: 2025, dossierNom: '***' }, 'csv')).toBe('inventaire-2025.csv')
  })
})

describe('les lignes du brouillon de ces jeux', () => {
  it('sont la paire que composent les deux écritures du module (garde du jeu d’essai)', () => {
    const attendues = lignesDe('o1', { date: '2025-12-31', journal: 'OD', libelle: '', lignes: [{ compte: '486100', sens: 'debit', centimes: 60_000 }, { compte: '616000', sens: 'credit', centimes: 60_000 }] })
    expect(attendues).toEqual(ECRITURES_CCA.slice(0, 2))
  })
})
