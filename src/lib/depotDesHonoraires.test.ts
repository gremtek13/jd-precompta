import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  cheminDuDepot, DEPOT_DES_HONORAIRES_PREVU, etatDuDepot, nomDuFichierDepose, REFUS_DU_DEPOT, refusDuDepot,
  type DepotLu, type FactureADeposer, type RefusDuDepot,
} from './depotDesHonoraires'

// Le module redit la fonction `deposer_honoraires_chez_le_client` de la migration préparée (LM8) : ses mots, leur ordre,
// le chemin qu'elle accepte et le nom qu'elle compose. Confronté au TEXTE de la migration, il ne peut pas en diverger sans
// rougir ; l'essai de la base (supabase/essais/depotDesHonoraires.sql) éprouve la fonction elle-même.

const dossier = new URL('../../supabase/preparees/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_depot_des_honoraires\.sql$/.test(n))!, 'utf8')
const FONCTION = /create function public\.deposer_honoraires_chez_le_client\([\s\S]*?\n\$\$;/i.exec(MIGRATION)![0]
const enSql = (texte: string) => `'${texte.replaceAll("'", "''")}'`

const CLIENT = '1b800000-0000-4000-8000-0000000000c1'
const AUTRE_CLIENT = '1b800000-0000-4000-8000-0000000000c2'
const facture = (f: Partial<FactureADeposer> = {}): FactureADeposer => ({
  id: 'f1', type: 'facture', statut: 'validee', mentions_figees: true, numero: 'F2026-0001', facture_origine_id: null, ...f,
})
const depot = (d: Partial<DepotLu> = {}): DepotLu => ({
  facture_id: 'f1', depot: 1, dossier_client_id: CLIENT, piece_id: 'p1', depose_le: '2026-11-11T10:00:00Z', presente: true, ...d,
})
const entree = (e: Partial<Parameters<typeof refusDuDepot>[0]> = {}) => ({
  estDossierDuCabinet: true, facture: facture(), clientDesHonoraires: CLIENT, dossierClientOuvert: true as boolean | null,
  depots: [] as DepotLu[], ...e,
})

describe('le dépôt des honoraires, drapeau baissé', () => {
  it('rien ne l’appelle tant que la migration n’est pas en production', () => {
    expect(DEPOT_DES_HONORAIRES_PREVU).toBe(false)
  })
})

describe('les refus redits, confrontés à la migration', () => {
  it('chaque refus est dans la fonction, à ses mots', () => {
    for (const [cle, texte] of Object.entries(REFUS_DU_DEPOT)) expect(FONCTION, cle).toContain(enSql(texte))
  })

  it('dans l’ordre où la fonction les lève, et la fonction n’en lève pas d’autre', () => {
    const leves = [...FONCTION.matchAll(/raise exception '((?:[^']|'')*)'/g)].map(([, m]) => m.replaceAll("''", "'"))
    const parMot = new Map(Object.entries(REFUS_DU_DEPOT).map(([cle, texte]) => [texte as string, cle]))
    expect(leves.map((m) => parMot.get(m) ?? `inconnu : ${m}`)).toEqual(Object.keys(REFUS_DU_DEPOT))
  })

  it('le chemin composé est de la forme que la fonction exige ; un sous-dossier ou un autre type, non', () => {
    const motif = /p_chemin !~ '([^']+)'/.exec(FONCTION)![1]
    const forme = new RegExp(motif)
    expect(forme.test(cheminDuDepot(CLIENT, 1762855200000, facture()))).toBe(true)
    expect(forme.test(cheminDuDepot(CLIENT, 1762855200000, facture({ type: 'avoir', numero: 'A2026/0001 bis' })))).toBe(true)
    expect(forme.test(cheminDuDepot(CLIENT, 1762855200000, facture({ numero: null })))).toBe(true)
    expect(cheminDuDepot(CLIENT, 1762855200000, facture())).toBe(`${CLIENT}/1762855200000-honoraires-facture-f2026-0001.pdf`)
    expect(forme.test(`${CLIENT}/sous/x.pdf`)).toBe(false)
    expect(forme.test(`${CLIENT}/x.png`)).toBe(false)
    expect(forme.test('pas-un-dossier/x.pdf')).toBe(false)
  })

  it('le nom du fichier est celui que la base compose', () => {
    expect(FONCTION).toContain("v_nom := case when v_type = 'avoir' then 'Avoir ' else 'Facture ' end || coalesce(v_facture.numero, '') || '.pdf';")
    expect(nomDuFichierDepose(facture())).toBe('Facture F2026-0001.pdf')
    expect(nomDuFichierDepose(facture({ type: 'avoir', numero: 'F2026-0002' }))).toBe('Avoir F2026-0002.pdf')
  })
})

describe('ce que l’écran juge avant le clic', () => {
  const cas: [string, Partial<Parameters<typeof refusDuDepot>[0]>, RefusDuDepot | null][] = [
    ['un dossier qui n’est pas celui du cabinet, avant tout', { estDossierDuCabinet: false, facture: null }, 'dossierDuCabinet'],
    ['une facture introuvable', { facture: null }, 'introuvable'],
    ['un brouillon', { facture: facture({ statut: 'brouillon' }) }, 'pasValidee'],
    ['une facture reprise', { facture: facture({ statut: 'importee' }) }, 'repriseOuNonFigee'],
    ['une facture qui n’a pas figé ses mentions', { facture: facture({ mentions_figees: false }) }, 'repriseOuNonFigee'],
    ['une facture sans honoraires', { clientDesHonoraires: null }, 'sansHonoraires'],
    ['un dossier client fermé au compte', { dossierClientOuvert: false }, 'dossierClientFerme'],
    ['la facture déjà chez le client', { depots: [depot()] }, 'dejaDeposee'],
    ['la facture dont la pièce a été retirée : de nouveau', { depots: [depot({ presente: false })] }, null],
    ['un dossier client dont l’ouverture n’est pas sue : la base jugera', { dossierClientOuvert: null }, null],
    ['la facture validée, jamais déposée', {}, null],
  ]
  it.each(cas)('%s', (_, e, attendu) => {
    expect(refusDuDepot(entree(e))).toBe(attendu)
  })

  it('un avoir : après sa facture, encore chez le même client', () => {
    const avoir = facture({ id: 'a1', type: 'avoir', facture_origine_id: 'f1', numero: 'F2026-0002' })
    expect(refusDuDepot(entree({ facture: avoir }))).toBe('avoirAvantSaFacture')
    expect(refusDuDepot(entree({ facture: avoir, depots: [depot({ presente: false })] }))).toBe('avoirAvantSaFacture')
    expect(refusDuDepot(entree({ facture: avoir, depots: [depot({ dossier_client_id: AUTRE_CLIENT })] }))).toBe('avoirAvantSaFacture')
    expect(refusDuDepot(entree({ facture: facture({ ...avoir, facture_origine_id: null }), depots: [depot()] }))).toBe('avoirAvantSaFacture')
    expect(refusDuDepot(entree({ facture: avoir, depots: [depot()] }))).toBe(null)
    expect(refusDuDepot(entree({ facture: avoir, depots: [depot(), depot({ facture_id: 'a1', piece_id: 'pa' })] }))).toBe('dejaDeposee')
  })
})

describe('l’état du dépôt d’une facture', () => {
  it('jamais, chez le client, ou retirée', () => {
    expect(etatDuDepot('f1', [])).toEqual({ etat: 'jamais' })
    expect(etatDuDepot('f1', [depot()]).etat).toBe('chez_le_client')
    expect(etatDuDepot('f1', [depot({ presente: false, depot: 2 })])).toEqual({ etat: 'retiree', depot: depot({ presente: false, depot: 2 }) })
    expect(etatDuDepot('f2', [depot()])).toEqual({ etat: 'jamais' })
  })
})
