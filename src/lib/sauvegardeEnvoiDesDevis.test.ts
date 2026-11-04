import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEVIS_EXPORTES, ENVOI_DES_DEVIS_PREVU } from './devis'
import {
  auGrapheDeLEnvoiDesDevis,
  COLONNES_GENEREES,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  RELATIONS,
  RELATIONS_DE_L_ENVOI_DES_DEVIS,
  RELATIONS_PREVUES,
  sansColonnesGenerees,
  violationsOrdre,
} from './sauvegarde'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// L'ENVOI D'UN DEVIS PAR E-MAIL AU PLAN DE SAUVEGARDE (espace client, étape P6c1 ; migration `envoi_des_devis`, préparée,
// PAS APPLIQUÉE). Ni table, ni chemin nouveaux : une colonne sur une table au plan, `emails_envoyes.devis_id`, et sa clé
// vers `devis`, à nul à la suppression du devis. La relation est déclarée au graphe PRÉVU ; le graphe du jour ne la porte
// que le drapeau `ENVOI_DES_DEVIS_PREVU` levé (sauvegardeRelations.test.ts juge le graphe du jour contre l'export, qui ne
// porte pas la migration). Ici : la relation telle que la migration la pose, le filtre dans ses deux états, ce que porte
// l'export, l'ordre de restauration qu'elle exige — les devis AVANT le journal des e-mails —, et le plan rechargé sous
// chaque état du drapeau, le graphe et l'ordre se calculant au chargement.

// La migration, où qu'elle soit : préparée aujourd'hui, dans l'export le jour de son application.
const MIGRATION = [...fichiersDuSchema(), ...fichiersPrepares()].find((f) => /\d{14}_envoi_des_devis\.sql$/.test(f.chemin))?.texte ?? ''
const DEVIS_ENVOYE = (r: { enfant: string; colonne: string }) => r.enfant === 'emails_envoyes' && r.colonne === 'devis_id'
const cle = (r: { enfant: string; colonne: string; parent: string; aLaSuppression: string }) =>
  `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`

describe('la relation du devis envoyé, au graphe prévu', () => {
  it('telle que la migration la pose : le journal vers le devis, à nul à la suppression, une fois', () => {
    expect(RELATIONS_DE_L_ENVOI_DES_DEVIS).toEqual([{ enfant: 'emails_envoyes', colonne: 'devis_id' }])
    const action = (texte: string) => /on delete cascade/.test(texte) ? 'cascade' : /on delete set null/.test(texte) ? 'met_a_null' : 'bloque'
    const deLaMigration = [...MIGRATION.matchAll(/alter table public\.emails_envoyes\s+add column (\w+) uuid references public\.(\w+) \(id\)([^;]*);/g)]
      .map((m) => `emails_envoyes.${m[1]} → ${m[2]} (${action(m[3])})`)
    expect(deLaMigration).toEqual(['emails_envoyes.devis_id → devis (met_a_null)'])
    expect(RELATIONS_PREVUES.filter(DEVIS_ENVOYE).map(cle)).toEqual(deLaMigration)
    // Rien d'autre que cette clé ne pointe le devis depuis le journal, et aucune garde ne la double.
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === 'emails_envoyes').map(cle).sort()).toEqual([
      'emails_envoyes.devis_id → devis (met_a_null)',
      'emails_envoyes.dossier_id → dossiers (cascade)',
      'emails_envoyes.facture_id → factures_emises (met_a_null)',
    ])
    expect(LIENS_GARDES.some((r) => r.enfant === 'emails_envoyes')).toBe(false)
  })

  it('le filtre : le devis envoyé seulement le drapeau levé ; toute autre relation, toujours', () => {
    for (const r of RELATIONS_PREVUES) {
      expect(auGrapheDeLEnvoiDesDevis(r, true), cle(r)).toBe(true)
      expect(auGrapheDeLEnvoiDesDevis(r, false), cle(r)).toBe(!DEVIS_ENVOYE(r))
    }
    expect(RELATIONS_PREVUES.filter((r) => !auGrapheDeLEnvoiDesDevis(r, false))).toHaveLength(1)
  })

  it('le graphe du jour suit le drapeau', () => {
    expect(RELATIONS.some(DEVIS_ENVOYE)).toBe(ENVOI_DES_DEVIS_PREVU)
  })

  it('le drapeau dit ce que porte l’export, et ne se lève qu’avec celui des devis', () => {
    expect(MIGRATION, 'la migration envoi_des_devis, préparée ou dans l’export').toContain('add column devis_id uuid references public.devis (id) on delete set null;')
    const exportee = fichiersDuSchema().some((f) => /\d{14}_envoi_des_devis\.sql$/.test(f.chemin))
    expect(ENVOI_DES_DEVIS_PREVU, 'ENVOI_DES_DEVIS_PREVU ne dit plus ce que porte l’export').toBe(exportee)
    expect(!ENVOI_DES_DEVIS_PREVU || DEVIS_EXPORTES, 'la migration de l’envoi exige la table des devis').toBe(true)
  })

  it('le devis envoyé se réinsère tel quel : ce n’est pas une colonne générée', () => {
    expect(COLONNES_GENEREES.emails_envoyes ?? []).not.toContain('devis_id')
    expect(sansColonnesGenerees('emails_envoyes', [{ id: 'e1', type: 'devis', devis_id: 'v1' }]))
      .toEqual([{ id: 'e1', type: 'devis', devis_id: 'v1' }])
  })
})

describe('l’ordre de restauration : les devis avant le journal qui les cite', () => {
  it('dans le plan prévu, la série, les devis et leurs liens juste avant le journal des e-mails', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang('devis')).toBeGreaterThanOrEqual(0)
    expect(rang('devis')).toBeLessThan(rang('emails_envoyes'))
    expect(ORDRE_RESTAURATION_PREVU[rang('emails_envoyes') - 1]).toBe('devis_factures')
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
  })

  it('l’ordre du jour, les devis hors du plan, est celui d’hier : le journal juste après les documents divers', () => {
    if (DEVIS_EXPORTES) return
    expect(ORDRE_RESTAURATION[ORDRE_RESTAURATION.indexOf('emails_envoyes') - 1]).toBe('documents_divers')
    expect(ORDRE_RESTAURATION[ORDRE_RESTAURATION.indexOf('emails_envoyes') + 1]).toBe('facture_lignes')
  })

  it('planté — le journal avant les devis, leur place d’avant l’étape P6c1 —, le contrôle de l’ordre le voit', () => {
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'emails_envoyes')
    plante.splice(plante.indexOf('devis_numerotation'), 0, 'emails_envoyes')
    expect(violationsOrdre(plante, RELATIONS_PREVUES.filter(DEVIS_ENVOYE)))
      .toEqual([{ enfant: 'emails_envoyes', parent: 'devis', motif: 'parent_apres_enfant' }])
  })
})

describe('le plan rechargé sous chaque état du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./devis')
    vi.resetModules()
  })

  // Le graphe et l'ordre sont calculés au chargement du module : on le recharge sous l'état voulu. Le jour de
  // l'application, les deux drapeaux sont levés ; avant, celui des devis peut l'être seul.
  async function sauvegardeSous(devis: boolean, envoi: boolean) {
    vi.resetModules()
    vi.doMock('./devis', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./devis')>()),
      DEVIS_EXPORTES: devis,
      ENVOI_DES_DEVIS_PREVU: envoi,
    }))
    return import('./sauvegarde')
  }

  // Un devis envoyé, une facture envoyée et une relance.
  const contenu = () => ({
    dossiers: [{ id: 'd' }],
    devis: [{ id: 'v1', dossier_id: 'd' }],
    emails_envoyes: [
      { id: 'e1', dossier_id: 'd', type: 'devis', devis_id: 'v1', facture_id: null },
      { id: 'e2', dossier_id: 'd', type: 'relance_pieces', devis_id: null, facture_id: null },
    ],
  })

  it('levé : la relation au graphe, le devis écrit avant le journal, et un devis absent laisse un lien effaçable', async () => {
    const s = await sauvegardeSous(true, true)
    expect(s.RELATIONS.some(DEVIS_ENVOYE)).toBe(true)
    expect(s.ORDRE_RESTAURATION.indexOf('devis')).toBeLessThan(s.ORDRE_RESTAURATION.indexOf('emails_envoyes'))
    expect(s.violationsOrdre(s.ORDRE_RESTAURATION, s.RELATIONS)).toEqual([])
    const plan = s.planReinsertion(contenu())
    expect(plan.tablesIgnorees).toEqual([])
    const tables = plan.etapes.map((e) => e.table)
    expect(tables.indexOf('devis')).toBeLessThan(tables.indexOf('emails_envoyes'))
    expect(s.liensPerdus(contenu())).toEqual([])
    // Le devis manque à la sauvegarde : la clé met à nul, la restauration peut effacer le lien — jamais en silence.
    expect(s.liensPerdus({ ...contenu(), devis: [] })).toEqual([
      { table: 'emails_envoyes', colonne: 'devis_id', parent: 'devis', valeur: 'v1', effacable: true },
    ])
  })

  it('baissé, les devis au plan : la colonne n’est pas au graphe — un devis absent ne dit rien', async () => {
    const s = await sauvegardeSous(true, false)
    expect(s.RELATIONS.some(DEVIS_ENVOYE)).toBe(false)
    expect(s.RELATIONS.some((r) => r.enfant === 'devis_factures' && r.parent === 'devis')).toBe(true)
    expect(s.liensPerdus({ ...contenu(), devis: [] })).toEqual([])
  })

  it('baissés tous deux — l’état du jour — : ni la relation ni les devis au plan, le journal à sa place d’hier', async () => {
    const s = await sauvegardeSous(false, false)
    expect(s.RELATIONS.some(DEVIS_ENVOYE)).toBe(false)
    expect(s.ORDRE_RESTAURATION).not.toContain('devis')
    expect(s.ORDRE_RESTAURATION[s.ORDRE_RESTAURATION.indexOf('emails_envoyes') - 1]).toBe('documents_divers')
    expect(s.planReinsertion(contenu()).tablesIgnorees).toEqual(['devis'])
  })

  it('le module chargé normalement dit ce que dit son drapeau', () => {
    expect(RELATIONS.some(DEVIS_ENVOYE)).toBe(ENVOI_DES_DEVIS_PREVU)
  })
})
