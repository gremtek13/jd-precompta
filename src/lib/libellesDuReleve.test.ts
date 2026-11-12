import ts from 'typescript'
import { readFileSync, readdirSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { ecritureDuMouvement, type MouvementBancaire } from './affectationBanque'
import { ecritureDuCompteDeBilan } from './compteDeBilan'
import { ecritureDeLaCotisation } from './cotisationRapprochee'
import { ecritureDeLEcheance } from './echeanceEmprunt'
import { ecritureDuPaiementTva } from './liquidationTva'
import {
  RACINES_DES_COMPTES_D_UN_CLIENT, debitQuiRendLArgentDUnClient, libelleDeLEcritureDuReleve, libellerLEcritureDuReleve,
} from './libellesDuReleve'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { ecritureDeLaVentilation } from './ventilationBanque'
import { ecritureDuVirementPersonnel } from './virementPersonnel'
import { modeleDeTest } from '../test/modeles'

// JJ1-Q1 : LE LIBELLÉ DE LA BANQUE HORS DES ÉCRITURES DU RELEVÉ (lib/libellesDuReleve.ts). Trois parties : la règle ; chaque
// chemin par lequel un mouvement du relevé reçoit son écriture, sur un crédit, un débit qui rend l'argent d'un client et un
// débit d'un fournisseur ; puis le relevé de TOUTE la source, qui refuse un libellé de la banque dans une écriture composée
// hors de la règle. Données FICTIVES.

const NOM = 'VIR SEPA RECU DE MME PATIENTE FICTIVE'

const mvt = (o: Partial<MouvementBancaire> = {}): MouvementBancaire => ({
  id: 'm1', date: '2026-01-05', libelle: NOM, libelle_brut: null, montant: 60, statut: 'non_rapprochee', piece_id: null,
  cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: 'releve.csv',
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
  reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, ...o,
})

const libelles = (lignes: readonly { libelle: string }[]) => [...new Set(lignes.map((l) => l.libelle))]

describe('la règle', () => {
  it('un crédit : « Crédit du relevé du JJ/MM/AAAA », jamais le texte de la banque, quels que soient les comptes', () => {
    for (const comptes of [['706000', '512000'], ['627000', '512000'], ['108000', '512000'], []]) {
      expect(libelleDeLEcritureDuReleve(mvt(), comptes)).toBe('Crédit du relevé du 05/01/2026')
    }
    expect(libelleDeLEcritureDuReleve(mvt({ montant: 0 }), ['706000'])).toBe('Crédit du relevé du 05/01/2026')
  })

  it('un débit sur un produit (classe 7) ou un client (classe 41) : « Débit du relevé du JJ/MM/AAAA »', () => {
    for (const compte of ['706000', '706200', '708000', '411000', '411PATIENT', '419100']) {
      expect(libelleDeLEcritureDuReleve(mvt({ montant: -45, libelle: 'REMB TROP PERCU MME FICTIVE' }), ['512000', compte]))
        .toBe('Débit du relevé du 05/01/2026')
    }
  })

  it('un autre débit garde le libellé de la banque, la ligne brute derrière le générique', () => {
    expect(libelleDeLEcritureDuReleve(mvt({ montant: -45, libelle: 'PRLV SEPA FOURNISSEUR FICTIF' }), ['606100', '445660', '512000']))
      .toBe('PRLV SEPA FOURNISSEUR FICTIF')
    // 401 (un fournisseur), 4 seul, 17, 70 ne sont pas 41 : seul le préfixe compte.
    expect(debitQuiRendLArgentDUnClient(['401000', '445710', '512000', '164000', '108000'])).toBe(false)
    expect(libelleDeLEcritureDuReleve(mvt({ montant: -45, libelle: 'Mouvement bancaire', libelle_brut: '12/03 PRLV URSSAF' }), ['646000']))
      .toBe('12/03 PRLV URSSAF')
  })

  it('libelle chaque ligne de la même façon, sur les comptes de toutes les lignes', () => {
    const lignes = libellerLEcritureDuReleve(mvt({ montant: -30 }), [
      { compte: '512000', sens: 'credit', montant: 30 }, { compte: '627000', sens: 'debit', montant: 10 },
      { compte: '706000', sens: 'debit', montant: 20 },
    ])
    expect(libelles(lignes)).toEqual(['Débit du relevé du 05/01/2026'])
    expect(lignes.map((l) => l.compte)).toEqual(['512000', '627000', '706000'])
  })

  it('les racines sont celles de l’assistant (VF9CQ1B, supabase/functions/agent-comptable)', () => {
    const source = readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
    const m = /const RACINES_DES_COMPTES_D_UN_CLIENT: readonly string\[\] = \[([^\]]*)\]/.exec(source)
    expect(m, 'la constante de l’assistant').not.toBeNull()
    expect(m![1].split(',').map((r) => r.trim().replace(/^"|"$/g, ''))).toEqual([...RACINES_DES_COMPTES_D_UN_CLIENT])
  })
})

describe('chaque chemin du relevé : un crédit, un débit qui rend l’argent d’un client, un débit d’un fournisseur', () => {
  const tresorerie = modeleDeTest('tresorerie')

  it('l’affectation à une catégorie — à la main, par une règle et ses lots, la recette d’un assujetti', () => {
    expect(libelles(ecritureDuMouvement(mvt(), '706000', null, PLAN_PAR_DEFAUT))).toEqual(['Crédit du relevé du 05/01/2026'])
    expect(libelles(ecritureDuMouvement(mvt({ montant: 72 }), '706000', 20, PLAN_PAR_DEFAUT))).toEqual(['Crédit du relevé du 05/01/2026'])
    expect(libelles(ecritureDuMouvement(mvt({ montant: -60, libelle: 'REMB MME FICTIVE' }), '706000', null, PLAN_PAR_DEFAUT)))
      .toEqual(['Débit du relevé du 05/01/2026'])
    expect(libelles(ecritureDuMouvement(mvt({ montant: -60, libelle: 'CB FOURNISSEUR FICTIF' }), '606400', null, PLAN_PAR_DEFAUT)))
      .toEqual(['CB FOURNISSEUR FICTIF'])
  })

  it('la ventilation : une part sur un produit suffit', () => {
    const categories = [{ id: 'rec', compte_comptable: '706000' }, { id: 'dep', compte_comptable: '606400' }]
    const parts = (signe: number) => [
      { categorie_id: 'rec', part_personnelle: false, montant: 20 * signe, taux_tva: null },
      { categorie_id: 'dep', part_personnelle: false, montant: 40 * signe, taux_tva: null },
    ]
    const ventiler = (m: MouvementBancaire, p: ReturnType<typeof parts>) => libelles(ecritureDeLaVentilation(m, p, categories, tresorerie, false)!)
    expect(ventiler(mvt(), parts(1))).toEqual(['Crédit du relevé du 05/01/2026'])
    expect(ventiler(mvt({ montant: -60, libelle: 'REMB MME FICTIVE' }), parts(-1))).toEqual(['Débit du relevé du 05/01/2026'])
    expect(ventiler(mvt({ montant: -60, libelle: 'CB FOURNISSEUR FICTIF' }), [{ ...parts(-1)[1], montant: -60 }]))
      .toEqual(['CB FOURNISSEUR FICTIF'])
  })

  it('le virement personnel', () => {
    expect(libelles(ecritureDuVirementPersonnel(mvt(), tresorerie))).toEqual(['Crédit du relevé du 05/01/2026'])
    expect(libelles(ecritureDuVirementPersonnel(mvt({ montant: -500, libelle: 'VIR VERS COMPTE PERSO' }), tresorerie)))
      .toEqual(['VIR VERS COMPTE PERSO'])
  })

  it('le compte de bilan, la caisse comprise : un client (411) rendu se tait, un fournisseur non', () => {
    expect(libelles(ecritureDuCompteDeBilan(mvt(), '411000', PLAN_PAR_DEFAUT))).toEqual(['Crédit du relevé du 05/01/2026'])
    expect(libelles(ecritureDuCompteDeBilan(mvt({ montant: -60, libelle: 'VIR REMB MME FICTIVE' }), '411000', PLAN_PAR_DEFAUT)))
      .toEqual(['Débit du relevé du 05/01/2026'])
    expect(libelles(ecritureDuCompteDeBilan(mvt({ montant: -60, libelle: 'VIR FOURNISSEUR FICTIF' }), '401000', PLAN_PAR_DEFAUT)))
      .toEqual(['VIR FOURNISSEUR FICTIF'])
    // La caisse : un versement d'espèces (un crédit) se tait ; un retrait pour la caisse garde le libellé du distributeur.
    expect(libelles(ecritureDuCompteDeBilan(mvt({ libelle: 'VERSEMENT ESPECES' }), PLAN_PAR_DEFAUT.caisse, PLAN_PAR_DEFAUT)))
      .toEqual(['Crédit du relevé du 05/01/2026'])
    expect(libelles(ecritureDuCompteDeBilan(mvt({ montant: -100, libelle: 'RETRAIT DAB' }), PLAN_PAR_DEFAUT.caisse, PLAN_PAR_DEFAUT)))
      .toEqual(['RETRAIT DAB'])
  })

  it('l’échéance de cotisation : le remboursement de l’organisme se tait, le prélèvement garde son libellé', () => {
    const cotisation = { montant_csg_crds: 10 }
    expect(libelles(ecritureDeLaCotisation(mvt({ montant: 50, libelle: 'VIR URSSAF REMB' }), cotisation, 'tresorerie', PLAN_PAR_DEFAUT)))
      .toEqual(['Crédit du relevé du 05/01/2026'])
    expect(libelles(ecritureDeLaCotisation(mvt({ montant: -50, libelle: 'PRLV URSSAF' }), cotisation, 'tresorerie', PLAN_PAR_DEFAUT)))
      .toEqual(['PRLV URSSAF'])
  })

  it('l’emprunt : le déblocage se tait, l’échéance garde son libellé', () => {
    const d = { echeance: 1, interets: 10, assurance: 2 }
    expect(libelles(ecritureDeLEcheance(mvt({ montant: 10000, libelle: 'DEBLOCAGE PRET' }), d, PLAN_PAR_DEFAUT)))
      .toEqual(['Crédit du relevé du 05/01/2026'])
    expect(libelles(ecritureDeLEcheance(mvt({ montant: -300, libelle: 'ECHEANCE PRET' }), d, PLAN_PAR_DEFAUT))).toEqual(['ECHEANCE PRET'])
  })

  it('la déclaration de TVA : le remboursement se tait, le paiement garde son libellé', () => {
    expect(libelles(ecritureDuPaiementTva(mvt({ montant: 300, libelle: 'VIR DGFIP' }), PLAN_PAR_DEFAUT))).toEqual(['Crédit du relevé du 05/01/2026'])
    expect(libelles(ecritureDuPaiementTva(mvt({ montant: -79, libelle: 'PRLV DGFIP TVA' }), PLAN_PAR_DEFAUT))).toEqual(['PRLV DGFIP TVA'])
  })

  it('la date au calendrier civil, quel que soit le fuseau : le 31 décembre reste le 31 décembre', () => {
    expect(libelles(ecritureDuMouvement(mvt({ date: '2025-12-31' }), '706000', null, PLAN_PAR_DEFAUT))).toEqual(['Crédit du relevé du 31/12/2025'])
    expect(libelles(ecritureDuMouvement(mvt({ date: '2026-01-01', montant: -5 }), '706000', null, PLAN_PAR_DEFAUT)))
      .toEqual(['Débit du relevé du 01/01/2026'])
  })
})

// ── Le relevé de toute la source ───────────────────────────────────────────────────────────────────────────────────────
//
// Il part de TOUTE la source de l'application (src/, hors tests et fabriques de test) et des Edge Functions (supabase/),
// par l'analyseur de TypeScript (les commentaires n'y comptent pas). UNE ÉCRITURE COMPOSÉE — un objet littéral qui porte
// un `libelle` et un `sens`, un `pieceRef` ou un `statut: 'proposee'` — ne lit le libellé de la banque (la propriété
// `libelle` ou `libelle_brut` d'un objet, ou `libelleExploitable(…)`) dans aucune de ses valeurs, directement ou par une
// variable locale, hors de lib/libellesDuReleve.ts. Les écritures qui recopient le libellé d'une AUTRE source (une ligne du
// brouillon, une ligne d'à-nouveaux, une catégorie, un bien) sont des exceptions, chacune avec sa raison ET son nombre.

interface Source { chemin: string; texte: string }
interface Trouvaille { chemin: string; ligne: number; texte: string }

const MODULE = 'src/lib/libellesDuReleve.ts'
const PROPRIETES_DE_LA_BANQUE: ReadonlySet<string> = new Set(['libelle', 'libelle_brut'])
const REGLE: ReadonlySet<string> = new Set(['libelleDeLEcritureDuReleve', 'libellerLEcritureDuReleve', 'libelleDUnMouvementDesVentes'])

const nomDuPropriete = (p: ts.ObjectLiteralElementLike): string | null =>
  p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null

function initialiseurDe(nom: string, depuis: ts.Node): ts.Expression | null {
  for (let a: ts.Node | undefined = depuis.parent; a; a = a.parent) {
    const instructions = ts.isBlock(a) || ts.isSourceFile(a) ? a.statements : null
    if (!instructions) continue
    for (const i of instructions) {
      if (!ts.isVariableStatement(i)) continue
      for (const d of i.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === nom && d.initializer) return d.initializer
    }
  }
  return null
}

function litLaBanque(e: ts.Node, profondeur = 0): boolean {
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    if (REGLE.has(e.expression.text)) return false
    if (e.expression.text === 'libelleExploitable') return true
  }
  if (ts.isPropertyAccessExpression(e) && PROPRIETES_DE_LA_BANQUE.has(e.name.text)) return true
  if (ts.isElementAccessExpression(e) && ts.isStringLiteral(e.argumentExpression) && PROPRIETES_DE_LA_BANQUE.has(e.argumentExpression.text)) return true
  if (ts.isIdentifier(e)) {
    const parent = e.parent
    if ((ts.isPropertyAccessExpression(parent) && parent.name === e) || (ts.isPropertyAssignment(parent) && parent.name === e)) return false
    if (profondeur >= 3) return false
    const init = initialiseurDe(e.text, e)
    return init !== null && litLaBanque(init, profondeur + 1)
  }
  let trouve = false
  ts.forEachChild(e, (c) => { if (!trouve && litLaBanque(c, profondeur)) trouve = true })
  return trouve
}

function estUneEcriture(o: ts.ObjectLiteralExpression): boolean {
  const noms = new Map(o.properties.map((p) => [nomDuPropriete(p), p] as const))
  if (!noms.has('libelle')) return false
  if (noms.has('sens') || noms.has('pieceRef')) return true
  const statut = noms.get('statut')
  return !!statut && ts.isPropertyAssignment(statut) && ts.isStringLiteral(statut.initializer) && statut.initializer.text === 'proposee'
}

function analyser(sources: readonly Source[]): { trouvees: Trouvaille[]; regle: Map<string, number> } {
  const trouvees: Trouvaille[] = []
  const regle = new Map<string, number>()
  for (const { chemin, texte } of sources) {
    if (chemin === MODULE) continue
    const sf = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, chemin.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visiter = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && REGLE.has(n.expression.text)) regle.set(chemin, (regle.get(chemin) ?? 0) + 1)
      if (ts.isObjectLiteralExpression(n) && estUneEcriture(n)) {
        for (const p of n.properties) {
          if (nomDuPropriete(p) !== 'libelle') continue
          const lit = ts.isPropertyAssignment(p) ? litLaBanque(p.initializer) : ts.isShorthandPropertyAssignment(p) && litLaBanque(p.name)
          if (lit) trouvees.push({ chemin, ligne: sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1, texte: p.getText(sf).slice(0, 120) })
        }
      }
      ts.forEachChild(n, visiter)
    }
    visiter(sf)
  }
  return { trouvees, regle }
}

function laSource(): Source[] {
  const racine = new URL('../../', import.meta.url)
  const sources: Source[] = []
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(new URL(dossier, racine), { withFileTypes: true })) {
      const chemin = `${dossier}${entree.name}`
      if (entree.isDirectory()) {
        if (chemin !== 'src/test') parcourir(`${chemin}/`)
      } else if (/\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name)) {
        sources.push({ chemin, texte: readFileSync(new URL(chemin, racine), 'utf8') })
      }
    }
  }
  parcourir('src/')
  parcourir('supabase/')
  return sources
}

const AUTRE_SOURCE = 'le libellé d’une autre source que le relevé'
const EXCEPTIONS: Readonly<Record<string, { nombre: number; raison: string }>> = {
  'src/lib/aNouveaux.ts': { nombre: 1, raison: `${AUTRE_SOURCE} : la ligne d’une balance reprise, devenue à-nouveau` },
  'src/pages/dossier/BalanceCard.tsx': { nombre: 1, raison: `${AUTRE_SOURCE} : la ligne d’une balance reprise, envoyée à \`enregistrer_a_nouveaux\`` },
  'src/lib/amortissements.ts': { nombre: 2, raison: `${AUTRE_SOURCE} : « Dotation AAAA — » et le libellé du bien` },
  'supabase/functions/agent-comptable/index.ts': { nombre: 2, raison: `${AUTRE_SOURCE} : la copie gardée de la dotation (le libellé du bien)` },
  'src/lib/reportDesSoldes.ts': { nombre: 1, raison: `${AUTRE_SOURCE} : le libellé du compte dont le solde se reporte` },
  'src/lib/caisse.ts': { nombre: 1, raison: `${AUTRE_SOURCE} : l’écriture d’une opération de caisse reçue, relue pour être jugée (la base compose son libellé)` },
  'src/lib/ecritureVenteFacturee.ts': { nombre: 1, raison: `${AUTRE_SOURCE} : l’écriture d’une vente facturée déjà composée, sous le libellé de lib/libellesDesVentes.ts` },
  'src/lib/ecrituresVentesFacturees.ts': { nombre: 1, raison: `${AUTRE_SOURCE} : l’écriture d’une vente facturée déjà composée, sous le libellé de lib/libellesDesVentes.ts` },
  'src/lib/stocks.ts': { nombre: 1, raison: `${AUTRE_SOURCE} : l’écriture d’un stock de clôture déjà composée (« Stock final au 31/12/AAAA (compte) »), relayée à \`enregistrer_stock_de_cloture\`` },
}

describe('aucun libellé de la banque hors de la règle, dans une écriture composée', () => {
  let sources: Source[] = []
  let releve: ReturnType<typeof analyser> = { trouvees: [], regle: new Map() }
  beforeAll(() => {
    sources = laSource()
    releve = analyser(sources)
  }, 60_000)

  it('n’en trouve aucun hors des exceptions, et chaque exception au nombre près', () => {
    const parFichier = new Map<string, Trouvaille[]>()
    for (const t of releve.trouvees) parFichier.set(t.chemin, [...(parFichier.get(t.chemin) ?? []), t])
    const fautes: string[] = []
    for (const [chemin, liste] of parFichier) {
      const exception = EXCEPTIONS[chemin]
      if (!exception) fautes.push(...liste.map((t) => `${t.chemin}:${t.ligne} ${t.texte}`))
      else if (liste.length !== exception.nombre) fautes.push(`${chemin} : ${liste.length} au lieu de ${exception.nombre} (${exception.raison})`)
    }
    for (const chemin of Object.keys(EXCEPTIONS)) if (!parFichier.has(chemin)) fautes.push(`${chemin} : exception sans objet`)
    expect(fautes.join('\n'), 'un libellé de la banque hors de lib/libellesDuReleve.ts (JJ1-Q1)').toBe('')
  })

  it('ne relève pas à l’aveugle : il voit chaque chemin du relevé passer par la règle', () => {
    expect(sources.length).toBeGreaterThan(250)
    for (const chemin of ['src/lib/affectationBanque.ts', 'src/lib/ventilationBanque.ts', 'src/lib/liquidationTva.ts', 'src/lib/cotisationRapprochee.ts']) {
      expect(releve.regle.get(chemin), chemin).toBe(1)
    }
    expect(releve.regle.get('src/lib/echeanceEmprunt.ts')).toBe(2)
    expect(releve.regle.get('src/lib/ecrituresVentesFacturees.ts')).toBe(1)
  })

  it('relève un défaut planté sous chacune de ses formes, et rien dans un commentaire ni par la règle', () => {
    const plante = [
      "// libelle: ligne.libelle, sens: 'debit' dans un commentaire ne compte pas.",
      "export const a = (ligne: L) => ({ compte: '706000', sens: 'credit', montant: 1, libelle: ligne.libelle })",
      "export const b = (ligne: L) => ({ compte: '706000', sens: 'credit', montant: 1, libelle: libelleExploitable(ligne) || 'x' })",
      'export function c(ligne: L) {',
      "  const libelle = `${ligne['libelle_brut']}`",
      "  return [{ compte: '512000', sens: 'debit', montant: 1, libelle }]",
      '}',
      "export const d = (ligne: L) => ({ libelle: ligne.libelle, statut: 'proposee' })",
      // Par la règle, ou un objet qui n'est pas une écriture (un écran nomme le mouvement, et c'est son droit) : rien.
      "export const e = (ligne: L) => ({ compte: '706000', sens: 'credit', montant: 1, libelle: libelleDeLEcritureDuReleve(ligne, []) })",
      'export const f = (ligne: L) => ({ libelle: ligne.libelle, montant: 1 })',
    ].join('\n')
    expect(analyser([{ chemin: 'src/lib/plante.ts', texte: plante }]).trouvees.map((t) => t.ligne)).toEqual([2, 3, 6, 8])
  })

  it('mord sur la source réelle : la règle défaite dans un chemin se relève', () => {
    const muter = (chemin: string, avant: string, apres: string) => {
      const s = sources.find((x) => x.chemin === chemin)!
      expect(s.texte.includes(avant), `${chemin} : « ${avant} »`).toBe(true)
      return analyser([{ chemin, texte: s.texte.replace(avant, apres) }]).trouvees.length
    }
    expect(muter('src/lib/affectationBanque.ts', '{ compte: compteCategorie, sens: sensCompte, montant: ht },',
      '{ compte: compteCategorie, sens: sensCompte, montant: ht, libelle: libelleExploitable(ligne) || ligne.libelle },')).toBe(1)
    expect(muter('src/lib/ventilationBanque.ts', 'lignes.push({ compte, sens, montant: ht })',
      'lignes.push({ compte, sens, montant: ht, libelle: ligne.libelle })')).toBe(1)
    expect(muter('src/lib/echeanceEmprunt.ts', "{ compte: plan.banque, sens: 'credit', montant: total },",
      "{ compte: plan.banque, sens: 'credit', montant: total, libelle: ligne.libelle },")).toBe(1)
  })
})
