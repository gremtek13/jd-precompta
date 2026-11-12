import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REFUS_DU_DEPOT, type DepotLu } from './depotDesHonoraires'
import {
  clientDeLaFacture, confirmationDuDepot, honorairesDeposesIllisibles, lignesDuDepot, motDuClientPourLaPiece, motsDeLEtat,
  type FactureDuDepot, type LettreDuClient, type LienLu,
} from './depotDesHonorairesVue'

// LE DÉPÔT DES HONORAIRES, À L'ÉCRAN (ligne 47, LM8) : le client d'une facture comme `client_de_la_facture_d_honoraires` le lit
// (confronté au texte de la migration préparée), les lignes de la carte et leur refus avant le clic, l'état en mots, la
// confirmation qui nomme ce qui part et chez qui, et les mots de « Mes pièces ». Données FICTIVES.

const dossier = new URL('../../supabase/schema/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_depot_des_honoraires\.sql$/.test(n))!, 'utf8')
const CLIENT_DE_LA_FACTURE = /create function public\.client_de_la_facture_d_honoraires\([\s\S]*?\$\$;/i.exec(MIGRATION)![0]

const C1 = 'c1000000-0000-4000-8000-000000000001'
const C2 = 'c2000000-0000-4000-8000-000000000002'
const facture = (p: Partial<FactureDuDepot> = {}): FactureDuDepot => ({
  id: 'f1', type: 'facture', statut: 'validee', mentions_figees: true, numero: 'F2027-0001', facture_origine_id: null,
  date_emission: '2027-11-02', montant_ttc: 180, ...p,
})
const lien = (p: Partial<LienLu> = {}): LienLu => ({ id: 'h1', facture_id: 'f1', lettre_id: 'l1', cree_le: '2027-11-01T10:00:00Z', ...p })
const lettres: LettreDuClient[] = [{ id: 'l1', dossier_client_id: C1 }, { id: 'l2', dossier_client_id: C2 }]
const depot = (p: Partial<DepotLu> = {}): DepotLu => ({
  facture_id: 'f1', depot: 1, dossier_client_id: C1, piece_id: 'p1', depose_le: '2027-11-03T09:00:00Z', presente: true, ...p,
})

describe('le client d’une facture, comme la base le lit', () => {
  it('la migration lit la lettre du premier lien (par cree_le, puis id), et celle de la facture corrigée pour un avoir', () => {
    expect(CLIENT_DE_LA_FACTURE).toContain("case when f.type = 'avoir' then f.facture_origine_id else f.id end")
    expect(CLIENT_DE_LA_FACTURE).toMatch(/order by h\.cree_le, h\.id limit 1/)
  })

  it('le module dit de même', () => {
    const liens = [lien({ id: 'h2', lettre_id: 'l2', cree_le: '2027-11-01T10:00:00Z' }), lien({ id: 'h1' })]
    expect(clientDeLaFacture(facture(), liens, lettres)).toBe(C1)
    expect(clientDeLaFacture(facture(), [lien({ lettre_id: 'l2', cree_le: '2027-10-01T00:00:00Z' }), lien({ id: 'h0' })], lettres)).toBe(C2)
    expect(clientDeLaFacture(facture({ id: 'a1', type: 'avoir', facture_origine_id: 'f1' }), [lien()], lettres)).toBe(C1)
    expect(clientDeLaFacture(facture({ id: 'a1', type: 'avoir', facture_origine_id: null }), [lien()], lettres)).toBeNull()
    expect(clientDeLaFacture(facture({ id: 'f9' }), [lien()], lettres)).toBeNull()
    expect(clientDeLaFacture(facture(), [lien({ lettre_id: 'l9' })], lettres)).toBeNull()
  })
})

describe('les lignes de la carte', () => {
  const base = { liens: [lien()], lettres, dossiers: [{ id: C1, nom: 'Client fictif' }], depots: [] as DepotLu[] }

  it('ne montrent que les factures validées qui désignent un client par leurs honoraires', () => {
    const lignes = lignesDuDepot({ ...base, factures: [facture(), facture({ id: 'f2', numero: 'F2027-0002' }), facture({ id: 'f3', statut: 'brouillon' })] })
    expect(lignes.map((l) => l.facture.id)).toEqual(['f1'])
    expect(lignes[0]).toMatchObject({ clientId: C1, nomDuClient: 'Client fictif', etat: { etat: 'jamais' }, refus: null })
  })

  it('disent le refus avant le clic : un dossier client que le compte ne lit pas, un avoir avant sa facture, une facture non figée', () => {
    expect(lignesDuDepot({ ...base, dossiers: [], factures: [facture()] })[0].refus).toBe(REFUS_DU_DEPOT.dossierClientFerme)
    const avoir = facture({ id: 'a1', type: 'avoir', numero: 'A2027-0001', facture_origine_id: 'f1', date_emission: '2027-11-05' })
    const lignes = lignesDuDepot({ ...base, factures: [avoir, facture()] })
    expect(lignes.map((l) => l.facture.id)).toEqual(['f1', 'a1'])
    expect(lignes[1].refus).toBe(REFUS_DU_DEPOT.avoirAvantSaFacture)
    expect(lignesDuDepot({ ...base, depots: [depot()], factures: [avoir, facture()] })[1].refus).toBeNull()
    expect(lignesDuDepot({ ...base, factures: [facture({ mentions_figees: false })] })[0].refus).toBe(REFUS_DU_DEPOT.repriseOuNonFigee)
  })

  it('une facture chez le client est « déposée », une pièce retirée la rend à déposer (LM8-Q1)', () => {
    const chez = lignesDuDepot({ ...base, depots: [depot()], factures: [facture()] })[0]
    expect(chez.refus).toBe(REFUS_DU_DEPOT.dejaDeposee)
    expect(motsDeLEtat(chez.etat)).toBe('Déposée le 03/11/2027')
    const retiree = lignesDuDepot({ ...base, depots: [depot({ presente: false })], factures: [facture()] })[0]
    expect(retiree.refus).toBeNull()
    expect(motsDeLEtat(retiree.etat)).toMatch(/^À déposer — la pièce déposée le 03\/11\/2027 a été retirée/)
    expect(motsDeLEtat({ etat: 'jamais' })).toBe('À déposer')
  })
})

describe('les mots', () => {
  it('la confirmation nomme la facture, son montant, le fichier et le dossier du client', () => {
    const t = confirmationDuDepot({ facture: facture(), nomDuClient: 'Client fictif' }).replace(/\s/g, ' ')
    expect(t).toContain('la facture F2027-0001')
    expect(t).toContain('180,00 € TTC')
    expect(t).toContain('« Client fictif »')
    expect(t).toContain('« Facture F2027-0001.pdf »')
    expect(confirmationDuDepot({ facture: facture({ type: 'avoir', numero: 'A2027-0001' }), nomDuClient: 'X' })).toContain('l’avoir A2027-0001')
  })

  it('« Mes pièces » tutoie, et dit une lecture ratée', () => {
    expect(motDuClientPourLaPiece('facture')).toBe('Facture d’honoraires déposée par ton cabinet')
    expect(motDuClientPourLaPiece('avoir')).toBe('Avoir d’honoraires déposé par ton cabinet')
    expect(honorairesDeposesIllisibles('refus')).toContain('(refus)')
  })
})
