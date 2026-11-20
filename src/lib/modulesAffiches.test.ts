import { describe, expect, it } from 'vitest'
import { groupesDuParcours, ongletsValides, type DossierTab } from './ongletsDossier'
import {
  droitsMasques, MODULE_DE_L_ONGLET, MODULE_DE_LA_CASE, MODULES_OPTIONNELS, ongletOuvert, ROUTES_DE_L_ESPACE_CLIENT,
  routeDuClientOuverte, TOUS_LES_MODULES, type ModuleOptionnel,
} from './modulesDuCabinet'
import { MODULE_DU_POINT_HORS_DE_SON_ONGLET, pointsSousLesModules, type PointATraiter } from './pointsDeLaChecklist'
import type { DroitsAcces } from './droitsAcces'

// CE QUE LES ÉCRANS AFFICHENT SOUS LES MODULES DU CABINET (conception 56, OPT3) : tous ouverts, rien ne change ; au socle seul,
// ni la tenue ni la facturation ; chaque module seul ajoute ses écrans, et rien d'autre.

const ECRANS_DE_TOUT = ongletsValides(true, true, TOUS_LES_MODULES)
const scenarios: [string, readonly ModuleOptionnel[]][] = [
  ['tous ouverts', TOUS_LES_MODULES],
  ['socle seul', []],
  ...MODULES_OPTIONNELS.map((m): [string, readonly ModuleOptionnel[]] => [`${m} seul`, [m]]),
]

describe('la navigation d’un dossier sous les modules', () => {
  it('tous ouverts : chaque onglet de MODULE_DE_L_ONGLET, comme hier (22 écrans, caisse et inventaire offerts)', () => {
    expect([...ECRANS_DE_TOUT].sort()).toEqual(Object.keys(MODULE_DE_L_ONGLET).sort())
    for (const [caisse, inventaire] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      // Tous ouverts, aucun groupe n'est recomposé : le même objet revient.
      const tout = groupesDuParcours(caisse, inventaire, TOUS_LES_MODULES)
      const encore = groupesDuParcours(caisse, inventaire, MODULES_OPTIONNELS)
      expect(encore).toEqual(tout)
    }
  })

  for (const [nom, ouverts] of scenarios) {
    it(`${nom} : exactement les onglets de ses modules, et aucun groupe vide`, () => {
      const attendus = ECRANS_DE_TOUT.filter((t) => MODULE_DE_L_ONGLET[t] === 'socle' || ouverts.includes(MODULE_DE_L_ONGLET[t] as ModuleOptionnel))
      expect(ongletsValides(true, true, ouverts)).toEqual(attendus)
      for (const g of groupesDuParcours(true, true, ouverts)) {
        expect(g.cible !== undefined || (g.enfants ?? []).length > 0, g.id).toBe(true)
      }
    })
  }

  it('socle seul : ni Clôture, ni Bilan, ni Révision, ni Factures émises ; Écritures, Banque, Caisse et TVA restent', () => {
    const socle = ongletsValides(true, true, [])
    for (const t of ['cloture', 'bilan', 'revision', 'immobilisations', 'inventaire', 'estimation', 'supplements', 'factures'] as DossierTab[]) {
      expect(socle).not.toContain(t)
      expect(ongletOuvert(t, [])).toBe(false)
    }
    for (const t of ['checklist', 'pieces', 'documents', 'banque', 'caisse', 'ecritures', 'statistiques', 'tva', 'cotisations', 'financement', 'informations', 'acces', 'virements', 'packs'] as DossierTab[]) {
      expect(socle).toContain(t)
    }
  })
})

describe('l’espace client sous les modules', () => {
  const tout: DroitsAcces = { ventes: true, banque: true, caisse: true, comptes: true, achats: true, frais: true, documents: true }

  it('tous ouverts : les droits d’hier, champ par champ, et toutes les routes', () => {
    for (const bits of [0, 1, 37, 127]) {
      const droits = Object.fromEntries(Object.keys(tout).map((k, i) => [k, (bits >> i) % 2 === 1])) as unknown as DroitsAcces
      expect(droitsMasques(droits, TOUS_LES_MODULES)).toEqual(droits)
    }
    expect(ROUTES_DE_L_ESPACE_CLIENT.every((r) => routeDuClientOuverte(r, TOUS_LES_MODULES))).toBe(true)
  })

  for (const [nom, ouverts] of scenarios) {
    it(`${nom} : chaque case n’ouvre que sous son module ; une case décochée ne s’ouvre jamais`, () => {
      const masques = droitsMasques(tout, ouverts)
      for (const [d, module] of Object.entries(MODULE_DE_LA_CASE)) {
        expect(masques[d as keyof DroitsAcces], d).toBe(module === 'socle' || ouverts.includes(module as ModuleOptionnel))
      }
      const aucun = droitsMasques({ ...tout, ventes: false, banque: false, caisse: false, comptes: false, achats: false, frais: false, documents: false }, ouverts)
      expect(Object.values(aucun).every((v) => v === false)).toBe(true)
    })
  }

  it('socle seul : l’accueil, « Mes pièces », « Mes informations », « Mon échéancier », « Ma caisse » et la sécurité ; ni « Ma simulation » (la tenue)', () => {
    expect(ROUTES_DE_L_ESPACE_CLIENT.filter((r) => routeDuClientOuverte(r, []))).toEqual(
      ['/accueil', '/mes-pieces', '/mes-informations', '/mon-echeancier', '/ma-caisse', '/securite'],
    )
  })
})

describe('les points de la Vue d’ensemble sous les modules', () => {
  const point = (id: string, cible: DossierTab): PointATraiter => ({ id, label: id, action: 'Voir', nb: 1, cible, severite: 'attention' })
  const points = [
    point('lignes-non-rapprochees', 'banque'), point('postes-manquants', 'cloture'), point('ouverture-en-ecart', 'bilan'),
    point('encaissements-sans-mouvement', 'factures'), point('statut-tva', 'tva'), point('periodes-tva-non-declarees', 'tva'),
  ]

  it('tous ouverts : la liste d’hier, identique', () => {
    expect(pointsSousLesModules(points, TOUS_LES_MODULES)).toEqual(points)
  })

  it('socle seul : ni la clôture, ni le bilan, ni la facturation, ni la déclaration de TVA ; le statut de TVA reste', () => {
    expect(pointsSousLesModules(points, []).map((p) => p.id)).toEqual(['lignes-non-rapprochees', 'statut-tva'])
  })

  it('la tenue seule rend la déclaration de TVA ; la facturation seule, le registre des encaissements', () => {
    expect(pointsSousLesModules(points, ['tenue']).map((p) => p.id)).toContain('periodes-tva-non-declarees')
    expect(pointsSousLesModules(points, ['facturation']).map((p) => p.id)).toContain('encaissements-sans-mouvement')
    // Et les cinq contrôles des paiements de l'assurance maladie (NOE6), sous leur module, l'onglet Banque étant du socle.
    expect(Object.entries(MODULE_DU_POINT_HORS_DE_SON_ONGLET)).toEqual([
      ['periodes-tva-non-declarees', 'tenue'],
      ['assurance-maladie-credits-sans-paiement', 'assurance_maladie'], ['assurance-maladie-credits-hors-des-imports', 'assurance_maladie'],
      ['assurance-maladie-paiements-sans-credit', 'assurance_maladie'], ['assurance-maladie-associations-a-revoir', 'assurance_maladie'],
      ['assurance-maladie-exercices-en-ecart', 'assurance_maladie'],
    ])
  })
})
