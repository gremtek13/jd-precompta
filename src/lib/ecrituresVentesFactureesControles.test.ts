import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SANS_FACTURE_SOURCE, SANS_EXEMPLAIRE } from '../test/ventesFacturees'
import { ecriture } from '../test/revision'
import { idsMouvementsJustifiesParLeReleve, mouvementsAffectes, mouvementsAffectesDesynchronises } from './affectationBanque'
import { mouvementsSurUnCompteDeBilanDesynchronises } from './compteDeBilan'
import { analyserEcritures, ecrituresAGenerer, ecrituresSansObjet } from './ecritures'
import { ligneDUneVenteFacturee, mouvementsClassesParEncaissements } from './ecrituresVentesFactureesEcran'
import { liquidationsDesynchronisees, paiementsTvaDesynchronises } from './liquidationTva'
import { absenceFec, rupturesPisteAudit } from './pisteAudit'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { paiementsDesPieces } from './rattachement'
import type { EcritureBrouillon, LigneBancaire } from './types'
import { mouvementsVentilesDesynchronises } from './ventilationBanque'

// LES CONTRÔLES ET LES GESTES D'HIER DE L'ONGLET ÉCRITURES, DEVANT LES LIGNES D'UNE VENTE FACTURÉE (chantier EC-Q3, étape
// VF4c1). Une écriture de vente facturée n'a ni pièce, ni catégorie : sa justification est sa facture, son encaissement, ou
// le mouvement que ses encaissements classent. Un contrôle d'hier qui la jugerait la dirait sans justificatif, sans objet
// ou à régénérer, et un geste d'hier qui la réécrirait par un autre chemin buterait sur la garde G5.
//
// LE RELEVÉ, d'abord, par un SCANNER : chaque emploi du brouillon dans l'onglet (`ecritures`, `ecrituresFiltrees`,
// `ecrituresAffichees`) est rangé — argument d'une fonction, receveur d'une méthode —, et chaque emploi doit être dans
// l'inventaire ci-dessous, avec ce qu'il fait des lignes d'une vente facturée, au nombre près ; une forme non reconnue est
// une faute. Chaque écriture de l'onglet, de même : une suppression ou une insertion du brouillon, une fonction SQL. Un
// emploi ajouté demain sans y être rangé fait échouer ce garde, et oblige à se demander ce qu'il fait de ces lignes.
// PUIS LA PREUVE : chaque contrôle d'hier reçoit un brouillon fait des lignes d'une vente facturée, de toutes les formes,
// et ne les signale pas — sauf la piste d'audit, qui les dit rompues tant que l'onglet ne les écarte pas.

const TEXTE_ONGLET = readFileSync(join(process.cwd(), 'src/pages/dossier/EcrituresTab.tsx'), 'utf8')
const TEXTE_SECTION = readFileSync(join(process.cwd(), 'src/pages/dossier/VentesFactureesEcritures.tsx'), 'utf8')

const BROUILLON = new Set(['ecritures', 'ecrituresFiltrees', 'ecrituresAffichees'])

/** Chaque emploi d'un nom du brouillon, rangé : `appel:F`, `appel:F (filtré)`, `méthode:M`, ou `autre`. */
function emploisDuBrouillon(texte: string): string[] {
  const source = ts.createSourceFile('EcrituresTab.tsx', texte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const emplois: string[] = []
  const nomDeLAppel = (appel: ts.CallExpression) => {
    const e = appel.expression
    return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : e.getText()
  }
  const visiter = (n: ts.Node) => {
    if (ts.isIdentifier(n) && BROUILLON.has(n.text)) {
      const p = n.parent
      // La déclaration elle-même (`const [ecritures, setEcritures]`, `const ecrituresFiltrees = …`) n'est pas un emploi.
      if (ts.isBindingElement(p) || (ts.isVariableDeclaration(p) && p.name === n)) { /* déclaration */ }
      // Ni le NOM d'une propriété qui s'appelle de même (étape VF4c2) : `composition.ecritures`, les écritures composées des
      // ventes facturées, ou la clé `{ ecritures: … }` d'un objet — ce n'est pas le brouillon, et sa valeur, si elle en est
      // un emploi, est rangée à part.
      else if ((ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p)) && p.name === n) { /* nom de propriété */ }
      else if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        // Un receveur : `.length`, `.some(…)`, `.filter(…)`. Un `.filter` dont le résultat part à une fonction se range
        // sous cette fonction, filtré.
        const filtre = p.name.text === 'filter' && ts.isCallExpression(p.parent) && ts.isCallExpression(p.parent.parent)
          && p.parent.parent.arguments.includes(p.parent)
        emplois.push(filtre ? `appel:${nomDeLAppel(p.parent.parent as ts.CallExpression)} (filtré)` : `méthode:${p.name.text}`)
      } else if (ts.isCallExpression(p) && p.arguments.includes(n)) emplois.push(`appel:${nomDeLAppel(p)}`)
      else if ((ts.isPropertyAssignment(p) && p.initializer === n) || ts.isShorthandPropertyAssignment(p)) {
        // Une propriété d'un objet passé à une fonction : `etatDeLOuverture({ …, ecritures })`.
        const objet = p.parent
        const appel = objet.parent
        emplois.push(ts.isObjectLiteralExpression(objet) && ts.isCallExpression(appel) ? `appel:${nomDeLAppel(appel)}` : 'autre')
      } else if (ts.isConditionalExpression(p)) emplois.push('autre:conditionnelle')
      else emplois.push(`autre:${ts.SyntaxKind[p.kind]}`)
    }
    ts.forEachChild(n, visiter)
  }
  visiter(source)
  return emplois.sort()
}

// L'INVENTAIRE : chaque emploi, son nombre, et ce qu'il fait des lignes d'une vente facturée.
const INVENTAIRE: Record<string, { nombre: number; raison: string }> = {
  'appel:ecrituresAGenerer': { nombre: 1, raison: 'les pièces déjà écrites, par `piece_id` : une ligne sans pièce n’y entre pas' },
  'appel:analyserEcritures': { nombre: 1, raison: 'sans contrepartie, déséquilibrées, à régénérer : par pièce, les lignes sans pièce écartées' },
  'appel:ecrituresSansObjet': { nombre: 1, raison: 'part de l’écriture d’une PIÈCE (`piece_id` nul écarté)' },
  'appel:etatsDesLettragesManuels': { nombre: 1, raison: 'le lettrage à la main, par pièce ; une facture source se lettre par ses encaissements, jamais à la main' },
  'appel:lettrages': { nombre: 1, raison: 'le lettrage par pièce, et depuis VF4c2 par facture : le 411 d’une vente facturée quand ses lignes rattachées se soldent' },
  'appel:lettragesDesFactures': { nombre: 1, raison: 'VF4c2 : ce que la section dit du lettrage de chaque facture source, ou pourquoi il n’y en a pas' },
  'appel:rattachementDesVentes': { nombre: 1, raison: 'VF4c2 : les lignes de l’exercice que le FEC rattache à leur écriture composée — les autres, que le badge compte' },
  'appel:etatDeLOuverture': { nombre: 1, raison: 'ne lit que les dates : une écriture d’une vente facturée datée avant l’exercice le précède, comme une autre' },
  'appel:etatsDesVentesFacturees': { nombre: 1, raison: 'la section des ventes facturées : c’est elle qui juge ces lignes' },
  'appel:rupturesPisteAudit (filtré)': { nombre: 1, raison: 'les ruptures, SANS les lignes d’une vente facturée (`ligneDUneVenteFacturee`)' },
  'appel:mouvementsAffectesDesynchronises': { nombre: 1, raison: 'les mouvements affectés seuls ; un mouvement classé par ses encaissements ne l’est jamais (G1)' },
  'appel:mouvementsVentilesDesynchronises': { nombre: 1, raison: 'les mouvements ventilés seuls (G1)' },
  'appel:mouvementsSurUnCompteDeBilanDesynchronises': { nombre: 1, raison: 'les mouvements écrits sur un compte de bilan seuls (G1)' },
  'appel:liquidationsDesynchronisees': { nombre: 1, raison: 'par déclaration (`declaration_tva_id`)' },
  'appel:paiementsTvaDesynchronises': { nombre: 1, raison: 'les mouvements qui paient une déclaration seuls (G1)' },
  'appel:soldeCompte': { nombre: 3, raison: 'les totaux de TVA de l’exercice : la TVA collectée d’une vente facturée y compte, à bon droit' },
  'appel:numerotationValidee': { nombre: 1, raison: 'le FEC d’un exercice validé, relu de ce que la validation a figé : VF7 y numérotera ces lignes' },
  'appel:absenceFec (filtré)': { nombre: 1, raison: 'ce qui n’ira pas au FEC, SANS les lignes qu’il rattache (VF4c2) : celles d’une vente facturée à réécrire ou à retirer y restent, et le badge le dit' },
  'appel:genererFec': { nombre: 1, raison: 'le FEC, qui porte depuis VF4c2 les lignes rattachées à leur écriture composée' },
  'appel:pisteAudit': { nombre: 1, raison: 'l’export de la piste d’audit, qui justifie depuis VF4c2 ces lignes par leur facture, leur registre ou leur relevé' },
  'méthode:filter': { nombre: 4, raison: 'le compte des validées, l’exercice affiché, la recherche affichée : les lignes d’une vente facturée sont des écritures du journal comme les autres ; et (VF4c2) le compte de celles que le FEC ne rattache pas' },
  'méthode:length': { nombre: 8, raison: 'le compte des proposées ; le modèle verrouillé dès la première écriture, vente facturée comprise ; le FEC vide ; la recherche et le journal vides' },
  'méthode:some': { nombre: 2, raison: 'par `piece_id` : la part figée d’une pièce' },
  'méthode:map': { nombre: 1, raison: 'les lignes affichées du journal' },
  'autre:conditionnelle': { nombre: 1, raison: '`ecrituresFiltrees`, toutes années : le brouillon entier' },
}

describe('le relevé : chaque emploi du brouillon dans l’onglet Écritures, et ce qu’il fait d’une vente facturée', () => {
  it('chaque emploi est rangé dans l’inventaire, au nombre près — et rien d’autre', () => {
    const emplois = emploisDuBrouillon(TEXTE_ONGLET)
    // Plancher : un scanner qui ne trouverait rien serait aveugle.
    expect(emplois.length).toBeGreaterThanOrEqual(30)
    const comptes = new Map<string, number>()
    for (const e of emplois) comptes.set(e, (comptes.get(e) ?? 0) + 1)
    const attendus = Object.entries(INVENTAIRE)
    expect(Object.fromEntries(comptes)).toEqual(Object.fromEntries(attendus.map(([k, v]) => [k, v.nombre])))
    for (const [cle, { raison, nombre }] of attendus) expect(raison.length, `${cle} (${nombre}) a sa raison`).toBeGreaterThan(20)
  })

  it('la rupture de la piste d’audit reçoit le brouillon SANS les lignes d’une vente facturée', () => {
    expect(TEXTE_ONGLET).toMatch(/rupturesPisteAudit\(ecritures\.filter\(\(e\) => !ligneDUneVenteFacturee\(e, mouvementsDesVentes\)\), idsJustifies\)/)
  })

  it('le scanner voit ce qu’on y plante : un emploi nouveau, une forme non reconnue', () => {
    const plante = TEXTE_ONGLET.replace('const nbValidees =', 'const fautif = autreControle(ecritures)\n  const nbValidees =')
    expect(emploisDuBrouillon(plante)).toContain('appel:autreControle')
    const forme = TEXTE_ONGLET.replace('const nbValidees =', 'const copie = [...ecritures]\n  const nbValidees =')
    expect(emploisDuBrouillon(forme)).toContain('autre:SpreadElement')
  })

  it('le nom d’une propriété n’est pas un emploi ; sa valeur, si (étape VF4c2)', () => {
    const avant = emploisDuBrouillon(TEXTE_ONGLET)
    const nom = TEXTE_ONGLET.replace('const nbValidees =', 'const x = objet.ecritures\n  const y = { ecritures: 1 }\n  const nbValidees =')
    expect(emploisDuBrouillon(nom)).toEqual(avant)
    const valeur = TEXTE_ONGLET.replace('const nbValidees =', 'const y = { cle: ecritures }\n  const nbValidees =')
    expect(emploisDuBrouillon(valeur)).toHaveLength(avant.length + 1)
  })

  it('chaque écriture d’hier de l’onglet vise une PIÈCE ou un mouvement classé autrement, jamais une ligne d’une vente facturée', () => {
    // Les suppressions du brouillon : par pièce seulement (« Régénérer », « Retirer l'écriture »).
    const suppressions = [...TEXTE_ONGLET.matchAll(/from\('ecritures_brouillon'\)\.delete\(\)([^\n]*)/g)].map((m) => m[1])
    expect(suppressions).toHaveLength(4)
    for (const s of suppressions) expect(s).toMatch(/^\.eq\('piece_id', piece\.id\)/)
    // Les insertions du brouillon : les lignes d'une pièce (la génération, « Régénérer »).
    expect([...TEXTE_ONGLET.matchAll(/from\('ecritures_brouillon'\)\.insert\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['generation.lignes', 'lignes'])
    // Les fonctions SQL d'hier : chacune sur un mouvement classé autrement (une catégorie, une ventilation, un compte de
    // bilan, une déclaration de TVA), que G1 interdit à un mouvement classé par ses encaissements.
    expect([...TEXTE_ONGLET.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1])).toEqual([
      'affecter_mouvement_bancaire', 'ventiler_mouvement_bancaire', 'ecrire_mouvement_compte_bilan', 'ecrire_liquidation_tva',
      'rapprocher_declaration_tva',
    ])
    // Et la section : ses trois fonctions, et elles seules.
    expect([...TEXTE_SECTION.matchAll(/\.rpc\(([^,]+),/g)].map((m) => m[1])).toEqual(['fonction', "'choisir_compte_contrepartie'"])
    expect(TEXTE_SECTION).not.toMatch(/\.from\(/)
  })
})

// ── La preuve : les contrôles d'hier, devant les lignes d'une vente facturée ──────────────────────────────────────────

const D = 'd1'
const mouvement = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'm1', dossier_id: D, date: '2025-11-20', libelle: 'VIR CLIENT FICTIF', montant: 120, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  compte_bilan: null, declaration_tva_id: null, id_externe: null, source_fichier: 'releve.csv', libelle_brut: null,
  created_at: '2025-11-20T09:00:00Z', encaissements_de_factures: true, ...o,
})
const ligne = (o: Partial<EcritureBrouillon>) => ecriture({ dossier_id: D, ...o })

// Toutes les formes : la créance d'une facture en engagement, un encaissement (sa banque portant le mouvement), le mouvement
// que ses encaissements classent.
const LIGNES_DES_VENTES: EcritureBrouillon[] = [
  ligne({ id: 'v1', date: '2025-11-10', compte: '411000', sens: 'debit', montant: 120, facture_id: 'f1' }),
  ligne({ id: 'v2', date: '2025-11-10', compte: '706000', sens: 'credit', montant: 100, facture_id: 'f1' }),
  ligne({ id: 'v3', date: '2025-11-10', compte: '445800', sens: 'credit', montant: 20, facture_id: 'f1' }),
  ligne({ id: 'v4', date: '2025-11-20', compte: '512000', sens: 'debit', montant: 120, ligne_bancaire_id: 'm1', encaissement_id: 'e1' }),
  ligne({ id: 'v5', date: '2025-11-20', compte: '411000', sens: 'credit', montant: 120, encaissement_id: 'e1' }),
  ligne({ id: 'v6', date: '2025-11-22', compte: '512000', sens: 'debit', montant: 50, ligne_bancaire_id: 'm2' }),
  ligne({ id: 'v7', date: '2025-11-22', compte: '511000', sens: 'credit', montant: 50, ligne_bancaire_id: 'm2' }),
]
const MOUVEMENTS = [mouvement({ id: 'm1' }), mouvement({ id: 'm2', date: '2025-11-22', montant: 50 })]
const DANS_LES_DEUX_MODELES = [
  { mode: 'tresorerie' as const, compteNotesDeFrais: '455000' as const, plan: PLAN_PAR_DEFAUT },
  { mode: 'engagement' as const, compteNotesDeFrais: '455000' as const, plan: PLAN_PAR_DEFAUT },
]

describe('la preuve : aucun contrôle d’hier ne signale les lignes d’une vente facturée', () => {
  for (const modele of DANS_LES_DEUX_MODELES) {
    it(`${modele.mode} : ni sans objet, ni sans contrepartie, ni déséquilibrées, ni à régénérer, ni à générer`, () => {
      expect(ecrituresSansObjet(LIGNES_DES_VENTES, [], [], new Map(), null, PLAN_PAR_DEFAUT, SANS_FACTURE_SOURCE)).toEqual([])
      const paiements = paiementsDesPieces(MOUVEMENTS, [], [], [])
      expect(analyserEcritures(LIGNES_DES_VENTES, [], true, paiements, modele, null, SANS_EXEMPLAIRE)).toMatchObject({
        piecesSansContrepartie: [], groupesDesequilibres: [], piecesDesynchronisees: [],
      })
      expect(ecrituresAGenerer(D, [], LIGNES_DES_VENTES, true, paiements, modele, null)).toEqual({ pieces: [], lignes: [], dansUnExerciceValide: [] })
      expect(mouvementsVentilesDesynchronises(LIGNES_DES_VENTES, MOUVEMENTS, [], [], modele, true, null)).toEqual([])
    })
  }

  it('ni à réaffecter, ni à réécrire sur un compte de bilan, ni liquidation ou paiement de TVA à réécrire', () => {
    expect(mouvementsAffectesDesynchronises(LIGNES_DES_VENTES, mouvementsAffectes(MOUVEMENTS, [], true), null, PLAN_PAR_DEFAUT)).toEqual([])
    expect(mouvementsSurUnCompteDeBilanDesynchronises(LIGNES_DES_VENTES, MOUVEMENTS, null, PLAN_PAR_DEFAUT)).toEqual([])
    expect(liquidationsDesynchronisees(LIGNES_DES_VENTES, [], null, PLAN_PAR_DEFAUT)).toEqual([])
    expect(paiementsTvaDesynchronises(LIGNES_DES_VENTES, MOUVEMENTS, null, PLAN_PAR_DEFAUT)).toEqual([])
  })

  it('la piste d’audit les dirait rompues : l’onglet les écarte, et une vraie rupture reste vue', () => {
    const justifies = idsMouvementsJustifiesParLeReleve(MOUVEMENTS)
    // Sans le filtre, chacune serait « sans justificatif » — d'où le filtre de l'onglet.
    expect(rupturesPisteAudit(LIGNES_DES_VENTES, justifies).map((r) => r.ecriture.id)).toEqual(LIGNES_DES_VENTES.map((l) => l.id))
    const ventes = mouvementsClassesParEncaissements(MOUVEMENTS)
    const orpheline = ligne({ id: 'orpheline', compte: '606100' })
    expect(rupturesPisteAudit([...LIGNES_DES_VENTES, orpheline].filter((e) => !ligneDUneVenteFacturee(e, ventes)), justifies)
      .map((r) => r.ecriture.id)).toEqual(['orpheline'])
    // Et le FEC ne les porte pas encore (VF4c2) : le badge de l'onglet les compte, ce qui est vrai.
    expect(absenceFec(LIGNES_DES_VENTES, justifies).nb).toBe(LIGNES_DES_VENTES.length)
  })
})
