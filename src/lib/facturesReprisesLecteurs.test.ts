import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// LE GARDE DES LECTEURS DES FACTURES REPRISES (étape A8c, ligne 51.5). Une facture reprise de l'ancien logiciel
// (`statut = 'importee'`) ne compte que là où un lecteur s'est ouvert NOMMÉMENT, par lib/facturesReprises.ts
// (`estUneVente`, `estUneFactureReprise`, `etatsDesVentes`), jamais par un filtre élargi en silence. Ce garde lit le TEXTE
// des modules :
//   - un module OUVERT importe lib/facturesReprises.ts, et chacun de ses tests d'état à « validee » qui reste porte sa
//     raison et leur nombre — un test de plus, là où une reprise devait compter, le fait virer au rouge ;
//   - aucun module ouvert ni à ouvrir n'écrit l'état « importee » en dur (le drapeau ne s'y lirait pas), sauf la lecture
//     de la table des reprises, nommée et comptée ;
//   - les modules À OUVRIR sont comptés de même, au nombre près : le jour où l'un s'ouvre, il passe d'une liste à l'autre.
// Que le drapeau baissé ne compte aucune reprise, les tests des modules le jouent (un accesseur sur
// lib/facturesImportees.ts) : encaissementsDesReprisesJugement.test.ts, ventesFactureesDesReprises.test.ts,
// ventesFactureesLecture.test.ts, depuis A8c2, ecrituresVentesFactureesDesReprises.test.ts, et depuis A8c3,
// ecrituresVentesFactureesEcranDesReprises.test.ts et ecrituresVentesFactureesLecture.test.ts.

const ETAT_VALIDEE = /statut\s*[!=]==?\s*'validee'|'statut',\s*'validee'/g
const ETAT_IMPORTEE = /'importee'/g

const texte = (module: string) => readFileSync(new URL(`./${module}`, import.meta.url), 'utf8')
const compte = (t: string, motif: RegExp) => [...t.matchAll(motif)].length

interface Exception {
  validee: number
  importee: number
  raison: string
}

const OUVERTS: Record<string, Exception> = {
  'encaissementsFactures.ts': {
    validee: 3,
    importee: 0,
    raison: "l'obligation du statut « Encaissée » (une facture de l'application, que la plateforme transmet), les avoirs "
      + "VALIDÉS de l'application qui créditent une facture (`creditesDesAvoirs` : un avoir repris se lit par `RepriseDeLaFacture`), "
      + "l'exemplaire validé d'une facture (une pièce, pas une facture)",
  },
  'ventesFacturees.ts': { validee: 0, importee: 0, raison: '' },
  'ventesFactureesLecture.ts': {
    validee: 1,
    importee: 1,
    raison: "la requête d'hier, mot pour mot, le drapeau baissé ; et la TVA déclarée des documents repris, le drapeau levé",
  },
  // Étape A8c2 : les écritures, le FEC, la piste d'audit, le lettrage et la fiche d'un mouvement.
  'ecrituresVentesFacturees.ts': { validee: 0, importee: 0, raison: '' },
  'ecritureVenteFacturee.ts': {
    validee: 1,
    importee: 0,
    raison: "l'état d'une ÉCRITURE du brouillon (proposée ou validée) que le retrait lit, jamais celui d'une facture",
  },
  'ventesFactureesDesExports.ts': { validee: 0, importee: 0, raison: '' },
  'mouvementsDesVentes.ts': {
    validee: 2,
    importee: 0,
    raison: "les factures sources que la fiche d'un crédit et ses candidats proposent à l'encaissement : leur reste "
      + "(`resteAEncaisserVente`), que l'encaissé avant la reprise réduirait, attend A8d — une reprise n'y est pas proposée",
  },
  // Étape A8c3 : la composition passe les reprises depuis l'écran ; les factures sources des pièces et du pont.
  'ecrituresVentesFactureesEcran.ts': {
    validee: 1,
    importee: 0,
    raison: "l'état d'une LIGNE du brouillon (ses lignes validées ne se réécrivent ni ne se retirent), jamais celui d'une facture",
  },
  'facturesSources.ts': { validee: 0, importee: 0, raison: '' },
  // Étape A8c6 : l'avoir d'une facture reprise (lib/avoirDUneFactureReprise.ts), son émetteur et son CII.
  'factures.ts': { validee: 0, importee: 0, raison: '' },
  'acomptesDesFactures.ts': {
    validee: 2,
    importee: 0,
    raison: "les factures d'acompte d'un devis, en brouillon ou validées, que la finale reprend : une facture d'acompte ou "
      + "finale naît de son devis, dans l'application, et ne se reprend jamais de l'ancien logiciel",
  },
  'mentionsFigeesVue.ts': { validee: 0, importee: 0, raison: '' },
  'factureCii.ts': {
    validee: 1,
    importee: 0,
    raison: "« Seule une facture validée se transmet », dans le bloc que les fonctions qui transmettent copient : une facture "
      + 'reprise n’a pas de CII à elle (`refusDuCii` le dit sous ses mots, hors de la copie)',
  },
}

// Ce qui reste à ouvrir : rien depuis A8c6. La liste reste, vide, pour qu'un module neuf qui testerait l'état d'une facture
// y entre nommément, avec sa raison, plutôt que de passer inaperçu.
const A_OUVRIR: Record<string, { validee: number; raison: string }> = {}

describe('les lecteurs des factures reprises s’ouvrent nommément', () => {
  for (const [module, ex] of Object.entries(OUVERTS)) {
    it(`${module} : ouvert par lib/facturesReprises.ts, ses tests d'état comptés`, () => {
      const t = texte(module)
      expect(t).toMatch(/from '\.\/facturesReprises'/)
      expect(compte(t, ETAT_VALIDEE), ex.raison || module).toBe(ex.validee)
      expect(compte(t, ETAT_IMPORTEE), ex.raison || module).toBe(ex.importee)
      if (ex.validee + ex.importee > 0) expect(ex.raison.length).toBeGreaterThan(20)
    })
  }

  for (const [module, ex] of Object.entries(A_OUVRIR)) {
    it(`${module} : à ouvrir (${ex.raison}), compté au nombre près`, () => {
      const t = texte(module)
      expect(t).not.toMatch(/from '\.\/facturesReprises'/)
      expect(compte(t, ETAT_VALIDEE)).toBe(ex.validee)
      expect(compte(t, ETAT_IMPORTEE)).toBe(0)
    })
  }

  it('aucun module n’est à la fois ouvert et à ouvrir ; le prédicat vit dans un seul module', () => {
    expect(Object.keys(OUVERTS).filter((m) => m in A_OUVRIR)).toEqual([])
    // Le découpage d'A8c, au nombre près : treize modules ouverts (trois par A8c, quatre par A8c2, deux par A8c3, quatre par
    // A8c6), aucun à ouvrir.
    expect([Object.keys(OUVERTS).length, Object.keys(A_OUVRIR).length]).toEqual([13, 0])
    const predicat = texte('facturesReprises.ts')
    expect(predicat).toMatch(/export function estUneVente\(/)
    expect(predicat).toMatch(/export function estUneFactureReprise\(/)
    // Le drapeau se lit à chaque appel, par son import — jamais copié dans une constante au chargement.
    expect(predicat).not.toMatch(/const \w+ = FACTURES_IMPORTEES_PREVUES/)
  })

  it('le garde mord : un test d’état de plus, ou l’état « importee » écrit en dur, se compte', () => {
    expect(compte("if (f.statut === 'validee') return", ETAT_VALIDEE)).toBe(1)
    expect(compte(".eq('statut', 'validee')", ETAT_VALIDEE)).toBe(1)
    expect(compte("f.statut !== 'validee'", ETAT_VALIDEE)).toBe(1)
    expect(compte("x.statut === 'importee'", ETAT_IMPORTEE)).toBe(1)
  })
})
