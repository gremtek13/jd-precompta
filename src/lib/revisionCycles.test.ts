import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compteAmortissement } from './amortissements'
import * as comptes from './comptes'
import { libelleDuPlanComptable } from './comptes'
import {
  CONTROLES_HORS_CYCLE, CYCLE_DES_CONTROLES, CYCLES_DE_REVISION, controlesParCycle, cycleDuCompte, cycleDuControle,
  cyclesDuDossier, DESCRIPTION_DES_CYCLES, type CycleRevision, type DossierPourLesCycles,
} from './revisionCycles'

// ── Le rangement des comptes ──────────────────────────────────────────────────────────────────────────────────────

describe('le cycle d’un compte (conception, § 2.1)', () => {
  // Le tableau de la conception, compte par compte, et les exceptions qui l'emportent sur leur classe.
  const ATTENDUS: [string, CycleRevision][] = [
    ['512000', 'tresorerie'], ['580000', 'tresorerie'], ['530000', 'tresorerie'], ['590000', 'tresorerie'], ['503000', 'tresorerie'],
    ['706000', 'recettes'], ['791000', 'recettes'], ['758100', 'recettes'], ['786000', 'recettes'],
    ['606100', 'depenses'], ['625110', 'depenses'], ['616100', 'depenses'], ['658100', 'depenses'], ['686000', 'depenses'],
    ['695000', 'depenses'], ['6611', 'depenses'], ['631000', 'depenses'], ['651000', 'depenses'],
    ['205000', 'immobilisations'], ['218300', 'immobilisations'], ['275000', 'immobilisations'], ['281830', 'immobilisations'],
    ['2818311', 'immobilisations'], ['291000', 'immobilisations'], ['404000', 'immobilisations'], ['681100', 'immobilisations'],
    ['681500', 'immobilisations'], ['675000', 'immobilisations'], ['775000', 'immobilisations'],
    ['164000', 'emprunts'], ['165000', 'emprunts'], ['171000', 'emprunts'], ['661100', 'emprunts'], ['616800', 'emprunts'],
    ['66110001', 'emprunts'],
    ['421000', 'social'], ['431000', 'social'], ['437000', 'social'], ['646000', 'social'], ['646100', 'social'],
    ['641000', 'social'], ['645000', 'social'], ['644000', 'social'], ['647000', 'social'], ['648000', 'social'],
    ['445660', 'tva'], ['445710', 'tva'], ['445510', 'tva'], ['444000', 'tva'], ['447000', 'tva'], ['658000', 'tva'], ['758000', 'tva'],
    ['101000', 'capitaux'], ['108000', 'capitaux'], ['120000', 'capitaux'], ['129000', 'capitaux'], ['151000', 'capitaux'],
    ['181000', 'capitaux'], ['455000', 'capitaux'], ['467000', 'capitaux'], ['19', 'capitaux'],
    ['401000', 'tiers'], ['411000', 'tiers'], ['462000', 'tiers'], ['471000', 'tiers'], ['486000', 'tiers'], ['491000', 'tiers'], ['4', 'tiers'],
    ['310000', 'stocks'], ['603000', 'stocks'], ['713000', 'stocks'],
  ]
  for (const [compte, cycle] of ATTENDUS) {
    it(`${compte} → ${cycle}`, () => expect(cycleDuCompte(compte)).toBe(cycle))
  }

  it('n’en donne aucun hors des classes 1 à 7 : la validation refuse déjà un tel compte', () => {
    for (const compte of ['', '0', '012000', '801000', '899999', '901000', 'abc', ' 512000', 'x512']) {
      expect(cycleDuCompte(compte), compte).toBeNull()
    }
  })

  // LA TOTALITÉ, sans liste tenue à la main : chaque préfixe d'un à trois chiffres des classes 1 à 7, puis chaque compte
  // à six chiffres de ces classes — tout compte qu'un plan peut porter tombe dans un cycle.
  it('est total sur les classes 1 à 7 : chaque compte de un à six chiffres a un cycle', () => {
    let vus = 0
    for (let classe = 1; classe <= 7; classe++) {
      expect(cycleDuCompte(String(classe))).not.toBeNull()
      vus++
      for (let n = classe * 10; n < classe * 10 + 10; n++) { expect(cycleDuCompte(String(n))).not.toBeNull(); vus++ }
      for (let n = classe * 100; n < classe * 100 + 100; n++) { expect(cycleDuCompte(String(n))).not.toBeNull(); vus++ }
    }
    let sansCycle = 0
    for (let n = 100_000; n < 800_000; n++) if (cycleDuCompte(String(n)) === null) sansCycle++
    expect(sansCycle).toBe(0)
    expect(vus).toBe(7 * 111)
  })

  it('range un sous-compte comme son compte (ligne 43) : le plus long préfixe connu l’emporte', () => {
    expect(cycleDuCompte('51210001')).toBe('tresorerie')
    expect(cycleDuCompte('4040001')).toBe('immobilisations')
    expect(cycleDuCompte('6168001')).toBe('emprunts')
    expect(cycleDuCompte('7580001')).toBe('tva')
    expect(cycleDuCompte('4670001')).toBe('capitaux')
    expect(cycleDuCompte('6410001')).toBe('social')
  })

  it('range chaque compte que lib/comptes.ts nomme', () => {
    const nommes = (Object.values(comptes) as unknown[]).filter((v): v is string => typeof v === 'string' && /^\d{6}$/.test(v))
    expect(nommes.length).toBeGreaterThanOrEqual(25)
    for (const compte of nommes) expect(cycleDuCompte(compte), compte).not.toBeNull()
    for (const compte of Object.keys(comptes.LIBELLES_COMPTES)) expect(cycleDuCompte(compte), compte).not.toBeNull()
  })

  it('range chaque compte du plan que l’application nomme : celui que le libellé du plan reconnaît', () => {
    let nommes = 0
    for (let n = 1; n < 800; n++) {
      const compte = String(n)
      if (libelleDuPlanComptable(compte) === null) continue
      nommes++
      expect(cycleDuCompte(compte), compte).not.toBeNull()
    }
    // Le plancher qui distingue « tous rangés » d'« aucun lu ».
    expect(nommes).toBeGreaterThanOrEqual(50)
  })

  // LES COMPTES EN BASE, relevés par une lecture seule (`select compte_comptable, dossier_id is null from categories`,
  // de même pour `natures_immobilisation`), le 09/10/2026 et de nouveau le 10/10/2026 : dix catégories et huit natures,
  // toutes communes. Chacun a son cycle, et le compte d'amortissement de chaque nature aussi. La catégorie commune qui
  // écrit au 758000, le compte des arrondis de la CA3, va à la TVA : un compte ne dit pas qui l'a écrit (revisionCycles.ts).
  const CATEGORIES_EN_BASE: [string, CycleRevision][] = [
    ['606100', 'depenses'], ['613200', 'depenses'], ['616100', 'depenses'], ['622600', 'depenses'], ['625100', 'depenses'],
    ['625700', 'depenses'], ['627000', 'depenses'], ['628000', 'depenses'], ['706000', 'recettes'], ['758000', 'tva'],
  ]
  const NATURES_EN_BASE = ['205000', '215400', '218000', '218100', '218200', '218300', '218300', '218400']

  it('range chaque compte de catégorie relevé en base', () => {
    for (const [compte, cycle] of CATEGORIES_EN_BASE) expect(cycleDuCompte(compte), compte).toBe(cycle)
  })

  it('range chaque compte de nature relevé en base, et son compte d’amortissement, au registre', () => {
    for (const compte of NATURES_EN_BASE) {
      expect(cycleDuCompte(compte), compte).toBe('immobilisations')
      expect(cycleDuCompte(compteAmortissement(compte)), compteAmortissement(compte)).toBe('immobilisations')
    }
  })
})

// ── Les cycles d'un dossier ───────────────────────────────────────────────────────────────────────────────────────

describe('les cycles d’un dossier (conception, § 2.1, colonne « Dossiers »)', () => {
  const vide: DossierPourLesCycles = { mode: 'tresorerie', assujettiTva: false, nbBiens: 0, nbEmprunts: 0, comptesDeBilan: [], cyclesDesControles: [] }

  it('les codes sont ceux de la conception, que la contrainte de l’étape R4 reprendra', () => {
    expect([...CYCLES_DE_REVISION]).toEqual([
      'tresorerie', 'recettes', 'depenses', 'immobilisations', 'emprunts', 'social', 'tva', 'capitaux', 'tiers', 'stocks', 'ensemble',
    ])
    for (const cycle of CYCLES_DE_REVISION) {
      expect(DESCRIPTION_DES_CYCLES[cycle].libelle, cycle).not.toBe('')
      expect(DESCRIPTION_DES_CYCLES[cycle].dossiers, cycle).not.toBe('')
    }
  })

  it('un dossier en trésorerie, sans bien, sans emprunt, non redevable : les six cycles de tous les dossiers', () => {
    expect(cyclesDuDossier(vide)).toEqual(['tresorerie', 'recettes', 'depenses', 'social', 'capitaux', 'ensemble'])
  })

  it('le registre, un emprunt, la TVA d’un redevable, l’engagement ouvrent leur cycle, chacun le sien', () => {
    const plus = (o: Partial<DossierPourLesCycles>) => cyclesDuDossier({ ...vide, ...o }).filter((c) => !cyclesDuDossier(vide).includes(c))
    expect(plus({ nbBiens: 1 })).toEqual(['immobilisations'])
    expect(plus({ nbEmprunts: 1 })).toEqual(['emprunts'])
    expect(plus({ assujettiTva: true })).toEqual(['tva'])
    expect(plus({ mode: 'engagement' })).toEqual(['tiers'])
    expect(cyclesDuDossier({ ...vide, nbBiens: 1, nbEmprunts: 1, assujettiTva: true, mode: 'engagement' })).not.toContain('stocks')
  })

  it('un compte de bilan porté par l’exercice ouvre toujours son cycle : aucun solde ne se range dans une carte cachée', () => {
    expect(cyclesDuDossier({ ...vide, comptesDeBilan: ['218300'] })).toContain('immobilisations')
    expect(cyclesDuDossier({ ...vide, comptesDeBilan: ['164000'] })).toContain('emprunts')
    expect(cyclesDuDossier({ ...vide, comptesDeBilan: ['445660'] })).toContain('tva')
    expect(cyclesDuDossier({ ...vide, comptesDeBilan: ['401000'] })).toContain('tiers')
    expect(cyclesDuDossier({ ...vide, comptesDeBilan: ['310000'] })).toContain('stocks')
    for (let n = 100_000; n < 600_000; n += 997) {
      const compte = String(n)
      expect(cyclesDuDossier({ ...vide, comptesDeBilan: [compte] }), compte).toContain(cycleDuCompte(compte))
    }
  })

  it('un contrôle qui a quelque chose à dire ouvre aussi son cycle', () => {
    expect(cyclesDuDossier({ ...vide, cyclesDesControles: ['tva'] })).toContain('tva')
    expect(cyclesDuDossier({ ...vide, cyclesDesControles: ['immobilisations'] })).toContain('immobilisations')
    expect(cyclesDuDossier({ ...vide, cyclesDesControles: ['stocks'] })).toContain('stocks')
  })

  it('les rend dans l’ordre de l’écran', () => {
    const tous = cyclesDuDossier({ mode: 'engagement', assujettiTva: true, nbBiens: 1, nbEmprunts: 1, comptesDeBilan: ['310000'], cyclesDesControles: [] })
    expect(tous).toEqual([...CYCLES_DE_REVISION])
  })

  it('dit pourquoi les stocks et les tiers ne sont pas couverts, et seulement eux', () => {
    const nonCouverts = CYCLES_DE_REVISION.filter((c) => DESCRIPTION_DES_CYCLES[c].nonCouvert !== null)
    expect(nonCouverts).toEqual(['tiers', 'stocks'])
  })
})

// ── Les contrôles existants, rangés par cycle ─────────────────────────────────────────────────────────────────────

// LES DEUX SOURCES, LUES : chaque contrôle de la Checklist et chaque préalable de la validation a un cycle, ou est hors
// cycle avec sa raison — la discipline de `POINTS_DE_LA_CHECKLIST_ECARTES`. Un contrôle ajouté demain doit dire de quel
// cycle il est ; un rangement qui nomme un contrôle disparu se retire.
describe('le rangement des contrôles existants', () => {
  const checklist = readFileSync(new URL('../pages/dossier/ChecklistTab.tsx', import.meta.url), 'utf8')
  const prealables = readFileSync(new URL('./prealablesValidation.ts', import.meta.url), 'utf8')
    .split('export const POINTS_DE_LA_CHECKLIST_ECARTES')[0]

  // Les points de la Checklist : tout objet qui commence par `id: '…'` — points à traiter et documents attendus —, et
  // les familles dont l'identifiant porte l'année (`id: \`banque-${…}\``).
  function idsDeLaChecklist(source: string): string[] {
    return [
      ...[...source.matchAll(/\{\s*id: '([a-z0-9-]+)'/g)].map((m) => m[1]),
      ...[...source.matchAll(/\bid: `([a-z]+)-\$\{/g)].map((m) => m[1]),
    ]
  }
  const idsDesPrealables = (source: string) => [...source.matchAll(/\bid: '([a-z0-9-]+)'/g)].map((m) => m[1])
  // Tout identifiant écrit en dur dans les deux sources, sous quelque forme que ce soit : ce que les deux lecteurs
  // doivent avoir vu — une forme qu'ils ne reconnaissent pas est une faute, jamais un saut.
  const toutIdentifiant = (source: string) => [...source.matchAll(/\bid: ['`]([a-z0-9-]+)/g)].map((m) => m[1])

  it('lit bien les deux sources — le plancher qui distingue « rien à redire » d’« aveugle »', () => {
    expect(new Set(idsDeLaChecklist(checklist)).size).toBeGreaterThanOrEqual(45)
    expect(new Set(idsDesPrealables(prealables)).size).toBeGreaterThanOrEqual(55)
    expect(idsDeLaChecklist(checklist)).toEqual(expect.arrayContaining(['banque', 'cotisations', 'factures', 'informations']))
  })

  it('aucun identifiant des deux sources n’échappe aux lecteurs', () => {
    const lus = new Set([...idsDeLaChecklist(checklist), ...idsDesPrealables(prealables)])
    const vus = [...toutIdentifiant(checklist), ...toutIdentifiant(prealables)].map((id) => id.replace(/-$/, ''))
    expect(vus.filter((id) => !lus.has(id))).toEqual([])
  })

  it('range chaque contrôle de la Checklist et chaque préalable, ou le dit hors cycle', () => {
    const orphelins = [...new Set([...idsDeLaChecklist(checklist), ...idsDesPrealables(prealables)])]
      .filter((id) => cycleDuControle(id, 'tresorerie') === null && !(id in CONTROLES_HORS_CYCLE))
    expect(orphelins).toEqual([])
  })

  it('ne range que des contrôles qui existent, et n’en met aucun à la fois dans un cycle et hors cycle', () => {
    const existants = new Set([...idsDeLaChecklist(checklist), ...idsDesPrealables(prealables)])
    for (const id of [...Object.keys(CYCLE_DES_CONTROLES), ...Object.keys(CONTROLES_HORS_CYCLE)]) {
      expect(existants.has(id), `« ${id} » n’est ni un point de la Checklist ni un préalable`).toBe(true)
    }
    for (const id of Object.keys(CONTROLES_HORS_CYCLE)) expect(id in CYCLE_DES_CONTROLES, id).toBe(false)
  })

  it('le lecteur voit un contrôle ajouté, et le refuserait sans cycle', () => {
    const ajoute = `${checklist}\n{ id: 'controle-nouveau', label: 'x', severite: 'erreur' }\nid: \`releves-\${annee}\``
    const lus = idsDeLaChecklist(ajoute)
    expect(lus).toEqual(expect.arrayContaining(['controle-nouveau', 'releves']))
    expect(lus.filter((id) => cycleDuControle(id, 'tresorerie') === null && !(id in CONTROLES_HORS_CYCLE)))
      .toEqual(['controle-nouveau', 'releves'])
  })

  it('range une famille annuelle par son préfixe, et rien d’inconnu', () => {
    expect(cycleDuControle('banque-2025', 'tresorerie')).toBe('tresorerie')
    expect(cycleDuControle('cotisations-2024', 'engagement')).toBe('social')
    expect(cycleDuControle('factures-2026', 'tresorerie')).toBe('depenses')
    expect(cycleDuControle('banque', 'tresorerie')).toBe('tresorerie')
    expect(cycleDuControle('inconnu-2025', 'tresorerie')).toBeNull()
    expect(cycleDuControle('banque-25', 'tresorerie')).toBeNull()
    expect(cycleDuControle('lecture-partielle', 'tresorerie')).toBeNull()
    // Ni ce que tout objet hérite : un identifiant n'est rangé que s'il l'est ici.
    for (const id of ['constructor', 'toString', '__proto__', 'valueOf-2025', 'constructor-2025']) {
      expect(cycleDuControle(id, 'tresorerie'), id).toBeNull()
    }
  })

  it('« sans contrepartie » suit le modèle : une écriture qui attend son mouvement, ou une facture sans règlement', () => {
    expect(cycleDuControle('sans-contrepartie', 'tresorerie')).toBe('tresorerie')
    expect(cycleDuControle('sans-contrepartie', 'engagement')).toBe('tiers')
  })

  it('range des contrôles par cycle, dans leur ordre, et ne perd ni un hors cycle ni un inconnu', () => {
    const controles = [
      { id: 'releve-incoherent', nb: 1 }, { id: 'concordance', nb: 2 }, { id: 'mouvements-a-traiter', nb: 3 },
      { id: 'lecture-partielle', nb: null }, { id: 'inconnu', nb: 4 }, { id: 'sans-contrepartie', nb: 5 }, { id: 'constructor', nb: 6 },
    ]
    const tresorerie = controlesParCycle(controles, 'tresorerie')
    expect(tresorerie.parCycle.get('tresorerie')?.map((c) => c.id)).toEqual(['releve-incoherent', 'mouvements-a-traiter', 'sans-contrepartie'])
    expect(tresorerie.parCycle.get('ensemble')?.map((c) => c.id)).toEqual(['concordance'])
    expect([...tresorerie.parCycle.keys()]).toEqual(['tresorerie', 'ensemble'])
    expect(tresorerie.horsCycle.map((c) => c.id)).toEqual(['lecture-partielle'])
    expect(tresorerie.inconnus.map((c) => c.id)).toEqual(['inconnu', 'constructor'])
    // Chaque contrôle est rangé une fois, et une seule.
    expect([...tresorerie.parCycle.values()].flat().length + tresorerie.horsCycle.length + tresorerie.inconnus.length).toBe(controles.length)
    expect(controlesParCycle(controles, 'engagement').parCycle.get('tiers')?.map((c) => c.id)).toEqual(['sans-contrepartie'])
  })

  // LE RANGEMENT, CYCLE PAR CYCLE, comme la conception énumère ce que l'application prouve déjà (§ 2.2) — à deux écarts
  // près, tirés du code et dits dans le module : « montant-suspect », que la conception cite sous les recettes, et
  // « piste-rompue », dont elle range une moitié (l'écriture de banque sans mouvement) à la trésorerie.
  const RANGEMENT: Record<CycleRevision, string[]> = {
    tresorerie: [
      'releve-incoherent', 'releves-inconnus', 'mouvements-a-traiter', 'lignes-non-rapprochees', 'mouvements-ignores',
      'rapproches-sans-objet', 'ventilations-incoherentes', 'reglements-groupes-incoherents', 'affectes-perimes',
      'ventiles-perimes', 'comptes-de-bilan-perimes', 'montant-suspect', 'banque',
    ],
    recettes: ['recettes-affectees-assujetti', 'ventes-en-double', 'jumelles-incoherentes'],
    depenses: [
      'pieces-a-valider', 'pieces-sans-date', 'date-impossible', 'sans-categorie', 'comptes-manquants', 'postes-manquants',
      'sans-tva', 'tva-impossible', 'devise-non-convertie', 'confiance-basse', 'mois-en-double', 'doublon-texte',
      'doublons-inconnus', 'ecritures-a-generer', 'desynchronisees', 'ecritures-sans-objet', 'pieces-payees-en-partie',
      'pieces-payees-en-trop', 'frais-vehicule-en-double', 'forfaits-a-ecrire', 'postes-sans-case', 'cases-negatives',
      'tickets', 'vacances', 'factures',
    ],
    immobilisations: ['immos-sans-justificatif', 'dotations-a-ecrire', 'vehicule-amorti-sous-bareme', 'vehicule'],
    emprunts: ['echeances-emprunt-perimees', 'echeances-emprunt-non-rapprochees'],
    social: [
      'cotisations-sans-ecriture', 'cotisations-rapprochement-refuse', 'csg-non-saisie', 'paiements-personnels-a-reprendre',
      'cotisations',
    ],
    tva: ['statut-tva', 'liquidations-tva-perimees', 'paiements-tva-perimes', 'periodes-tva-non-declarees'],
    capitaux: ['virements-sans-ecriture'],
    tiers: ['lettrages-qui-ne-tiennent-plus'],
    stocks: [],
    ensemble: [
      'exercice-en-cours', 'deja-valide', 'ordre', 'avant-ouverture', 'ouverture-d-abord', 'ecritures-anterieures',
      'exercice-anterieur-d-abord', 'ecritures-orphelines', 'ecritures-desequilibrees', 'desequilibrees', 'numerotation',
      'report-hors-classes', 'report-desequilibre', 'concordance', 'exclusions-2035', 'piste-rompue', 'informations',
    ],
  }

  it('range chaque contrôle dans le cycle où la conception le lit, quel que soit le modèle', () => {
    for (const cycle of CYCLES_DE_REVISION) {
      for (const id of RANGEMENT[cycle]) {
        expect(cycleDuControle(id, 'tresorerie'), id).toBe(cycle)
        expect(cycleDuControle(id, 'engagement'), id).toBe(cycle)
      }
    }
    // Le tableau est complet : chaque contrôle rangé y figure, « sans contrepartie » à part (il suit le modèle).
    expect(Object.values(RANGEMENT).flat().sort()).toEqual(Object.keys(CYCLE_DES_CONTROLES).filter((id) => id !== 'sans-contrepartie').sort())
  })
})
