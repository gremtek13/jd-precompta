import ts from 'typescript'
import { readFileSync, readdirSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { identificationDuClient, type FactureDuClient } from './champsBncDuFec'
import { auxiliaireDuTiers } from './engagement'
import {
  LONGUEUR_DU_LIBELLE_D_UN_MOUVEMENT, libelleDUnMouvementDesVentes, libelleDUnePiece, libelleDUneVenteFacturee, nomDuClientEcrit,
  LIBELLE_D_UNE_PIECE_SANS_DATE, sirenDuClient, tiersAuFec, type PieceLibellee,
} from './libellesDesVentes'
import type { Piece } from './types'
import { modeleDeTest } from '../test/modeles'

// FEC22-Q7 : LE NOM DU CLIENT HORS DES LIBELLÉS D'UNE VENTE (lib/libellesDesVentes.ts). Deux parties : la règle, cas par
// cas, confrontée au prédicat d'IdClient ; puis le relevé de TOUTE la source, qui refuse un nom lu hors de la règle dans
// une écriture composée ou dans le compte auxiliaire du FEC. Données FICTIVES.

const SIRET_VALIDE = '12345678200010'
const SIREN_VALIDE = '123456782'
const SIRET_INVALIDE = '12345678200011'
const SIREN_INVALIDE = '123456789'

// Le nom du fichier est porté par la pièce telle que l'appelant la lit, même si la règle ne le lit pas : une règle qui le
// relirait (une mutation) le rendrait.
type PieceLue = PieceLibellee & Pick<Piece, 'nom_fichier'>
const piece = (o: Partial<PieceLue> = {}): PieceLue => ({
  type_piece: 'vente', tiers: 'Patient Fictif', nom_fichier: 'facture-patient-fictif.pdf', date_piece: '2026-03-05', ...o,
})

describe('la règle', () => {
  it('une entreprise — un SIRET ou un SIREN qui passe la clé — garde son nom, ses blancs ramenés à un seul', () => {
    for (const siret of [SIRET_VALIDE, SIREN_VALIDE]) {
      expect(sirenDuClient({ tiers_siret: siret })).toBe(SIREN_VALIDE)
      expect(nomDuClientEcrit({ tiers_siret: siret, tiers_nom: '  Clinique   Fictive  SAS ' })).toBe('Clinique Fictive SAS')
      expect(libelleDUneVenteFacturee('Facture F2026-0001', { tiers_siret: siret, tiers_nom: 'Clinique Fictive SAS' }))
        .toBe('Facture F2026-0001 — Clinique Fictive SAS')
    }
  })

  it('un particulier, un SIRET mal formé ou faux, un nom vide : le numéro seul, aucun nom', () => {
    for (const siret of [null, '', SIRET_INVALIDE, SIREN_INVALIDE, '123 456 782 00010', '1234567820001', 'FR12345678200010']) {
      expect(sirenDuClient({ tiers_siret: siret })).toBeNull()
      expect(nomDuClientEcrit({ tiers_siret: siret, tiers_nom: 'Patient Fictif' })).toBeNull()
      expect(libelleDUneVenteFacturee('Encaissement, facture F2026-0001', { tiers_siret: siret, tiers_nom: 'Patient Fictif' }))
        .toBe('Encaissement, facture F2026-0001')
    }
    expect(nomDuClientEcrit({ tiers_siret: SIRET_VALIDE, tiers_nom: '   ' })).toBeNull()
    expect(libelleDUneVenteFacturee('Avoir A2026-0001', { tiers_siret: SIRET_VALIDE, tiers_nom: ' ' })).toBe('Avoir A2026-0001')
  })

  it('« entreprise » se juge EXACTEMENT comme IdClient : le même SIREN, ou le numéro de la facture', () => {
    const sirets = [null, '', SIRET_VALIDE, SIREN_VALIDE, SIRET_INVALIDE, SIREN_INVALIDE, '35600000000048', '35600000012345', '12345678200010 ']
    for (const tiers_siret of sirets) {
      const f: FactureDuClient = { id: 'f1', numero: 'F2026-0001', statut: 'validee', tiers_siret, source_de_la_vente: true }
      const siren = sirenDuClient(f)
      expect(identificationDuClient(f)).toBe(siren ?? 'F2026-0001')
      expect(nomDuClientEcrit({ tiers_siret, tiers_nom: 'Nom Fictif' }) !== null).toBe(siren !== null)
    }
  })

  it('un mouvement du relevé que ses encaissements classent (JJ1) : sa date et les numéros cités, jamais un particulier', () => {
    const patient = (numero: string) => ({ numero, tiers_siret: null, tiers_nom: 'Patiente Fictive' })
    const clinique = (numero: string) => ({ numero, tiers_siret: SIRET_VALIDE, tiers_nom: 'Clinique  Fictive' })
    // Les numéros sans doublon, dans l'ordre des octets, quel que soit l'ordre des encaissements.
    expect(libelleDUnMouvementDesVentes('2026-12-16', [patient('F2026-0003'), patient('F2026-0001'), patient('F2026-0003')]))
      .toBe('Relevé du 16/12/2026 — F2026-0001, F2026-0003')
    // Toutes d'entreprises : chacune avec son nom, par la règle.
    expect(libelleDUnMouvementDesVentes('2026-12-16', [clinique('F2026-0002'), clinique('F2026-0001')]))
      .toBe('Relevé du 16/12/2026 — F2026-0001 — Clinique Fictive, F2026-0002 — Clinique Fictive')
    // Une seule d'un particulier, et personne n'est nommé.
    const mele = libelleDUnMouvementDesVentes('2026-12-16', [clinique('F2026-0002'), patient('F2026-0001')])
    expect(mele).toBe('Relevé du 16/12/2026 — F2026-0001, F2026-0002')
    expect(libelleDUnMouvementDesVentes('2026-12-16', [])).toBe('Relevé du 16/12/2026')
    // Trop long : les seuls numéros, puis le premier et le compte des autres — jamais plus que la longueur.
    const beaucoup = Array.from({ length: 40 }, (_, i) => patient(`F2026-${String(i + 1).padStart(4, '0')}`))
    expect(libelleDUnMouvementDesVentes('2026-12-16', beaucoup)).toBe('Relevé du 16/12/2026 — F2026-0001 et 39 autres factures')
    const longues = Array.from({ length: 12 }, (_, i) => clinique(`F2026-${String(i + 1).padStart(4, '0')}`))
    expect(libelleDUnMouvementDesVentes('2026-12-16', longues)).toBe(`Relevé du 16/12/2026 — ${longues.map((f) => f.numero).join(', ')}`)
    for (const l of [mele, libelleDUnMouvementDesVentes('2026-12-16', beaucoup)]) {
      expect(l.length).toBeLessThanOrEqual(LONGUEUR_DU_LIBELLE_D_UN_MOUVEMENT)
      expect(l).not.toMatch(/patiente|clinique/i)
    }
  })

  it('une pièce de vente déposée : « Recette » et sa date, jamais le tiers lu ni le nom du fichier', () => {
    expect(libelleDUnePiece(piece())).toBe('Recette du 05/03/2026')
    expect(libelleDUnePiece(piece({ tiers: null }))).toBe('Recette du 05/03/2026')
    expect(libelleDUnePiece(piece({ date_piece: null }))).toBe('Recette')
    for (const p of [piece(), piece({ tiers: null }), piece({ date_piece: null })]) {
      expect(libelleDUnePiece(p)).not.toMatch(/patient|fictif|pdf/i)
    }
  })

  it('un achat, une note de frais, une autre pièce : le fournisseur lu, tel quel — comme hier', () => {
    expect(libelleDUnePiece(piece({ type_piece: 'achat', tiers: 'Fournisseur Fictif' }))).toBe('Fournisseur Fictif')
    expect(libelleDUnePiece(piece({ type_piece: 'achat', tiers: '  Fournisseur  Fictif ' }))).toBe('  Fournisseur  Fictif ')
    expect(libelleDUnePiece(piece({ type_piece: 'note_frais', tiers: 'Péage fictif' }))).toBe('Péage fictif')
    expect(libelleDUnePiece(piece({ type_piece: 'autre', tiers: 'Banque fictive' }))).toBe('Banque fictive')
  })

  // JJ1Q1-Q2 (réponse du cabinet du 08/11/2026) : le praticien a pu nommer le fichier d'après un patient.
  it('sans fournisseur lu : « Pièce du JJ/MM/AAAA », « Pièce sans date » sans date — jamais le nom du fichier', () => {
    for (const type_piece of ['achat', 'note_frais', 'autre'] as const) {
      expect(libelleDUnePiece(piece({ type_piece, tiers: null }))).toBe('Pièce du 05/03/2026')
      // Un tiers blanc n'a pas été lu : un libellé vide serait une faute du FEC (EcritureLib).
      expect(libelleDUnePiece(piece({ type_piece, tiers: '   ' }))).toBe('Pièce du 05/03/2026')
      expect(libelleDUnePiece(piece({ type_piece, tiers: null, date_piece: null }))).toBe(LIBELLE_D_UNE_PIECE_SANS_DATE)
      expect(LIBELLE_D_UNE_PIECE_SANS_DATE).toBe('Pièce sans date')
      for (const p of [piece({ type_piece, tiers: null }), piece({ type_piece, tiers: '', date_piece: null })]) {
        expect(libelleDUnePiece(p)).not.toMatch(/patient|fictif|pdf/i)
      }
    }
  })

  it('le compte auxiliaire du FEC : « Clients divers » pour une pièce de vente, le fournisseur pour un achat', () => {
    expect(auxiliaireDuTiers(tiersAuFec(piece()), '411000', modeleDeTest('engagement'))).toEqual({ num: 'CDIVERS', lib: 'Clients divers' })
    expect(auxiliaireDuTiers(tiersAuFec(undefined), '411000', modeleDeTest('engagement'))).toEqual({ num: 'CDIVERS', lib: 'Clients divers' })
    expect(auxiliaireDuTiers(tiersAuFec(piece({ type_piece: 'achat', tiers: 'Transmedical' })), '401000', modeleDeTest('engagement')))
      .toEqual({ num: 'FTRANSMEDICAL', lib: 'Transmedical' })
  })
})

// ── Le relevé de toute la source ───────────────────────────────────────────────────────────────────────────────────────
//
// Il part de TOUTE la source de l'application (src/, hors tests et fabriques de test) et des Edge Functions (supabase/),
// par l'analyseur de TypeScript (les commentaires n'y comptent pas), et relève trois formes :
//   - UNE ÉCRITURE COMPOSÉE qui lit un nom : un objet littéral qui porte un `libelle` et un `sens`, un `pieceRef` (une
//     écriture d'une vente facturée) ou un `statut: 'proposee'` (une ligne du brouillon) — et dont une valeur lit
//     `tiers_nom`, `tiers` ou `nom_fichier`, directement ou par une variable locale qui les lit (`const libelle = …`), hors
//     d'un appel à la règle ;
//   - LE LIBELLÉ DE LA BANQUE dans une écriture d'une vente facturée (un objet qui porte un `pieceRef`) : son `libelle`
//     qui lit la propriété `libelle` d'un objet (« VIR SEPA RECU DE MME … », qui nomme qui a payé : JJ1, relecture du jour
//     J), directement ou par une variable locale, hors d'un appel à la règle (`libelleDUnMouvementDesVentes`) ;
//   - UN COMPTE AUXILIAIRE qui lit un nom : un appel à `auxiliaireDuTiers` dont le tiers n'est ni `tiersAuFec(…)` ni
//     `{ tiers: null }`. Les écrans du cabinet (le lettrage à la main, les comptes de tiers, le bilan) regroupent par le nom
//     lu, et l'assistant recopie le lettrage à la main : des exceptions, chacune avec sa raison ET son nombre exact.

interface Source { chemin: string; texte: string }
interface Trouvaille { chemin: string; ligne: number; genre: 'ecriture' | 'auxiliaire' | 'releve'; texte: string }

const NOMS_LUS: ReadonlySet<string> = new Set(['tiers_nom', 'tiers', 'nom_fichier'])
const REGLE: ReadonlySet<string> = new Set([
  'libelleDUnePiece', 'libelleDUneVenteFacturee', 'libelleDUnMouvementDesVentes', 'nomDuClientEcrit', 'tiersAuFec',
])
// Le libellé d'un mouvement du relevé (« VIR SEPA RECU DE MME … ») : il nomme qui a payé (JJ1, relecture du jour J).
const LIBELLE_DU_RELEVE: ReadonlySet<string> = new Set(['libelle'])

function deroule(e: ts.Expression): ts.Expression {
  let x = e
  while (ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x)) x = x.expression
  return x
}

const nomDuPropriete = (p: ts.ObjectLiteralElementLike): string | null =>
  p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null

const appelleLaRegle = (n: ts.Node): boolean =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && REGLE.has(n.expression.text)

// La déclaration d'une variable locale visible depuis `depuis` : la plus proche, dans un bloc ou un corps qui l'englobe.
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

// L'expression lit-elle un nom ? Un appel à la règle n'en lit aucun — sauf par le début du libellé qu'on lui passe
// (`libelleDUneVenteFacturee`, que l'appelant compose) ; une variable locale se suit, jusqu'à trois fois. `noms` : les
// propriétés lues — les noms lus (`NOMS_LUS`, qu'une variable du même nom lit aussi), ou le libellé de la banque
// (`LIBELLE_DU_RELEVE`, lu seulement comme propriété : une variable locale `libelle` se suit jusqu'à ce qu'elle lit).
function litUnNom(e: ts.Node, profondeur = 0, noms: ReadonlySet<string> = NOMS_LUS): boolean {
  if (appelleLaRegle(e)) {
    const appel = e as ts.CallExpression
    return (appel.expression as ts.Identifier).text === 'libelleDUneVenteFacturee' && appel.arguments.length > 0
      && litUnNom(appel.arguments[0], profondeur, noms)
  }
  if (ts.isPropertyAccessExpression(e) && noms.has(e.name.text)) return true
  if (ts.isElementAccessExpression(e) && ts.isStringLiteral(e.argumentExpression) && noms.has(e.argumentExpression.text)) return true
  if (ts.isIdentifier(e)) {
    const parent = e.parent
    const nomDePropriete = (ts.isPropertyAccessExpression(parent) && parent.name === e) || (ts.isPropertyAssignment(parent) && parent.name === e)
    if (nomDePropriete) return false
    if (noms === NOMS_LUS && NOMS_LUS.has(e.text)) return true
    if (profondeur >= 3) return false
    const init = initialiseurDe(e.text, e)
    return init !== null && litUnNom(init, profondeur + 1, noms)
  }
  let trouve = false
  ts.forEachChild(e, (c) => {
    if (!trouve && litUnNom(c, profondeur, noms)) trouve = true
  })
  return trouve
}

function estUneEcriture(o: ts.ObjectLiteralExpression): boolean {
  const noms = new Map(o.properties.map((p) => [nomDuPropriete(p), p] as const))
  if (!noms.has('libelle')) return false
  if (noms.has('sens') || noms.has('pieceRef')) return true
  const statut = noms.get('statut')
  if (statut && ts.isPropertyAssignment(statut)) {
    const v = deroule(statut.initializer)
    return ts.isStringLiteral(v) && v.text === 'proposee'
  }
  return false
}

function analyser(sources: readonly Source[]): { trouvees: Trouvaille[]; ecritures: Map<string, number>; regleAuFec: Map<string, number> } {
  const trouvees: Trouvaille[] = []
  const ecritures = new Map<string, number>()
  const regleAuFec = new Map<string, number>()
  for (const { chemin, texte } of sources) {
    const sf = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, chemin.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const noter = (genre: Trouvaille['genre'], n: ts.Node) =>
      trouvees.push({ chemin, ligne: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, genre, texte: n.getText(sf).slice(0, 120) })
    const visiter = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n) && estUneEcriture(n)) {
        ecritures.set(chemin, (ecritures.get(chemin) ?? 0) + 1)
        for (const p of n.properties) {
          if (ts.isPropertyAssignment(p) && litUnNom(p.initializer)) noter('ecriture', p)
          else if (ts.isShorthandPropertyAssignment(p) && litUnNom(p.name)) noter('ecriture', p)
          // Le libellé de la banque, dans une écriture d'une vente facturée (celle qui porte un `pieceRef`) : jamais (JJ1).
          if (nomDuPropriete(p) !== 'libelle' || !n.properties.some((q) => nomDuPropriete(q) === 'pieceRef')) continue
          if (ts.isPropertyAssignment(p) && litUnNom(p.initializer, 0, LIBELLE_DU_RELEVE)) noter('releve', p)
          else if (ts.isShorthandPropertyAssignment(p) && litUnNom(p.name, 0, LIBELLE_DU_RELEVE)) noter('releve', p)
        }
      }
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'auxiliaireDuTiers' && n.arguments.length > 0) {
        const tiers = deroule(n.arguments[0])
        if (appelleLaRegle(tiers)) regleAuFec.set(chemin, (regleAuFec.get(chemin) ?? 0) + 1)
        else {
          const sansNom = ts.isObjectLiteralExpression(tiers) && tiers.properties.length === 1 && ts.isPropertyAssignment(tiers.properties[0])
            && nomDuPropriete(tiers.properties[0]) === 'tiers' && tiers.properties[0].initializer.kind === ts.SyntaxKind.NullKeyword
          if (!sansNom) noter('auxiliaire', n)
        }
      }
      ts.forEachChild(n, visiter)
    }
    visiter(sf)
  }
  return { trouvees, ecritures, regleAuFec }
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

const ECRAN_DU_CABINET = 'un écran du cabinet, qui ne sort pas du cabinet : il regroupe les pièces d’un même tiers par le nom lu '
  + '(`auxiliaireDuTiers`), et le FEC n’en reçoit que des codes de lettrage, uniques par compte général.'

const EXCEPTIONS: Readonly<Record<string, { nombre: number; raison: string }>> = {
  'src/lib/ecrituresVentesFacturees.ts': {
    nombre: 1,
    raison: '`auxiliaireDeLaLigne` lit `e.tiers`, le nom que la règle (`nomDuClientEcrit`) a donné à l’écriture composée — '
      + 'nul pour un particulier ; le premier relevé garde ce `tiers:` dans chaque écriture composée.',
  },
  'src/lib/lettrage.ts': { nombre: 5, raison: `Le lettrage à la main, ses propositions et les comptes de tiers : ${ECRAN_DU_CABINET}` },
  'src/lib/bilan.ts': { nombre: 1, raison: `Le bilan, compte de tiers par compte de tiers : ${ECRAN_DU_CABINET}` },
  'supabase/functions/agent-comptable/index.ts': {
    nombre: 1,
    raison: 'La copie gardée du lettrage à la main (bloc LETTRAGE MANUEL) : l’assistant juge si deux pièces sont d’un même tiers, '
      + 'et ne dit au modèle ni ce tiers ni son compte (VF9C-Q1).',
  },
}

describe('aucun nom lu hors de la règle, dans une écriture composée ni dans le compte auxiliaire du FEC', () => {
  let sources: Source[] = []
  let releve: ReturnType<typeof analyser> = { trouvees: [], ecritures: new Map(), regleAuFec: new Map() }
  const parFichier = new Map<string, Trouvaille[]>()
  beforeAll(() => {
    sources = laSource()
    releve = analyser(sources)
    for (const t of releve.trouvees) parFichier.set(t.chemin, [...(parFichier.get(t.chemin) ?? []), t])
  }, 60_000)

  it('n’en trouve aucun hors des exceptions, et chaque exception au nombre près', () => {
    const fautes: string[] = []
    for (const [chemin, liste] of parFichier) {
      const exception = EXCEPTIONS[chemin]
      const ecrituresFautives = liste.filter((t) => t.genre === 'ecriture' || t.genre === 'releve')
      fautes.push(...ecrituresFautives.map((t) => `${t.chemin}:${t.ligne} ${t.genre} ${t.texte}`))
      const auxiliaires = liste.filter((t) => t.genre === 'auxiliaire')
      if (!exception) fautes.push(...auxiliaires.map((t) => `${t.chemin}:${t.ligne} ${t.genre} ${t.texte}`))
      else if (auxiliaires.length !== exception.nombre) fautes.push(`${chemin} : ${auxiliaires.length} au lieu de ${exception.nombre} (${exception.raison})`)
    }
    for (const chemin of Object.keys(EXCEPTIONS)) if (!parFichier.has(chemin)) fautes.push(`${chemin} : exception sans objet`)
    expect(fautes.join('\n'), 'un nom de client lu hors de lib/libellesDesVentes.ts (FEC22-Q7)').toBe('')
  })

  it('ne relève pas à l’aveugle : il voit les écritures composées des pièces et des ventes facturées, et la règle au FEC', () => {
    expect(sources.length).toBeGreaterThan(250)
    expect(sources.some((s) => s.chemin === 'supabase/functions/agent-comptable/index.ts')).toBe(true)
    // ecritures.ts : la ligne de la charge, les contreparties banque, caisse et dirigeant ; engagement.ts : la facture et le
    // règlement ; ecrituresVentesFacturees.ts : la facture, l'encaissement, le mouvement, et la ligne au brouillon.
    expect(releve.ecritures.get('src/lib/ecritures.ts')).toBeGreaterThanOrEqual(4)
    expect(releve.ecritures.get('src/lib/engagement.ts')).toBeGreaterThanOrEqual(2)
    expect(releve.ecritures.get('src/lib/ecrituresVentesFacturees.ts')).toBeGreaterThanOrEqual(4)
    expect(releve.regleAuFec.get('src/lib/fec.ts')).toBe(1)
    // Et toutes les autres écritures composées — la caisse, l'inventaire, l'assistant. Celles d'un mouvement du relevé se
    // composent sans libellé et le reçoivent de `libellerLEcritureDuReleve` (JJ1-Q1), que libellesDuReleve.test.ts relève.
    expect([...releve.ecritures.values()].reduce((s, n) => s + n, 0)).toBeGreaterThan(25)
    expect(releve.ecritures.get('supabase/functions/agent-comptable/index.ts')).toBeGreaterThanOrEqual(4)
  })

  it('relève un défaut planté sous chacune de ses formes, et rien dans un commentaire ni par la règle', () => {
    const plante = [
      "// libelle: piece.tiers, sens: 'debit' dans un commentaire ne compte pas.",
      "export const a = (piece: P) => ({ libelle: piece.tiers ?? piece.nom_fichier, sens: 'debit', compte: '706000' })",
      'export function b(f: F) {',
      '  const nom = f.tiers_nom',
      '  const libelle = `Facture ${f.numero} — ${nom}`',
      "  return { libelle, statut: 'proposee' as const }",
      '}',
      "export const c = (f: F) => ({ libelle: libelleDUneVenteFacturee('Facture', f), pieceRef: f.numero, tiers: f['tiers_nom'] })",
      // Le début du libellé passé à la règle se lit aussi : la règle n'ajoute pas un nom que l'appelant y a mis.
      "export const c2 = (f: F) => ({ libelle: libelleDUneVenteFacturee(`Facture ${f.numero} — ${f.tiers_nom}`, f), sens: 'debit' })",
      "export const d = (piece: P) => ({ libelle: libelleDUnePiece(piece), sens: 'credit' })",
      "export const e = (f: F) => ({ libelle: 'x', pieceRef: 'y', tiers: nomDuClientEcrit(f) })",
      // Un objet qui n'est pas une écriture : un écran nomme le client, et c'est son droit.
      'export const g = (f: F) => ({ libelle: f.tiers_nom, montant: 1 })',
      'export const h = (piece: P) => auxiliaireDuTiers(piece, c)',
      'export const i = (piece: P) => auxiliaireDuTiers(tiersAuFec(piece), c)',
      'export const j = () => auxiliaireDuTiers({ tiers: null }, c)',
      "export const k = (f: F) => auxiliaireDuTiers({ tiers: f.tiers_nom }, '411000')",
      // Le libellé de la banque dans l'écriture d'une vente facturée (JJ1), directement ou par une variable locale…
      "export const m = (m: M) => ({ libelle: m.libelle, pieceRef: 'r', tiers: null })",
      "export function n(m: M) { const libelle = `Relevé ${m['libelle']}`; return { libelle, pieceRef: 'r' } }",
      // … mais pas par la règle, ni dans une écriture du relevé qui n'est pas d'une vente facturée (hors de FEC22-Q7).
      "export const o = (m: M) => ({ libelle: libelleDUnMouvementDesVentes(m.date, []), pieceRef: 'r' })",
      "export const q = (m: M) => ({ libelle: m.libelle, sens: 'debit', compte: '512000' })",
    ].join('\n')
    const { trouvees } = analyser([{ chemin: 'src/lib/plante.ts', texte: plante }])
    expect(trouvees.map((t) => `${t.ligne} ${t.genre}`)).toEqual([
      '2 ecriture', '6 ecriture', '8 ecriture', '9 ecriture', '13 auxiliaire', '16 auxiliaire', '17 releve', '18 releve',
    ])
  })

  it('mord sur la source réelle : chaque branchement de la règle, défait, se relève', () => {
    const muter = (chemin: string, avant: string, apres: string) => {
      const s = sources.find((x) => x.chemin === chemin)!
      expect(s.texte.includes(avant), `${chemin} : « ${avant} »`).toBe(true)
      return analyser([{ chemin, texte: s.texte.replace(avant, apres) }]).trouvees.filter((t) => t.genre !== 'auxiliaire' || !EXCEPTIONS[chemin])
    }
    expect(muter('src/lib/ecritures.ts', 'const libelle = libelleDUnePiece(piece)', 'const libelle = piece.tiers ?? piece.nom_fichier').length).toBeGreaterThan(0)
    expect(muter('src/lib/ecritures.ts', "libelle: libelleDUnePiece(piece), statut: 'proposee', compte: plan.banque",
      "libelle: piece.tiers ?? piece.nom_fichier, statut: 'proposee', compte: plan.banque").length).toBe(1)
    expect(muter('src/lib/engagement.ts', 'libelle: libelleDUnePiece(piece),', 'libelle: piece.tiers ?? piece.nom_fichier,').length).toBe(1)
    expect(muter('src/lib/ecrituresVentesFacturees.ts', 'tiers: nomDuClientEcrit(f),', 'tiers: f.tiers_nom,').length).toBe(1)
    expect(muter('src/lib/ecrituresVentesFacturees.ts', "${nommer(doc)}`, f)", "${nommer(doc)} — ${f.tiers_nom}`, f)").length).toBe(1)
    // JJ1 : le libellé de la banque revenu dans l'écriture d'un mouvement que ses encaissements classent.
    expect(muter('src/lib/ecrituresVentesFacturees.ts', 'libelle: libelleDUnMouvementDesVentes(m.date, justifies.map(citee))',
      'libelle: m.libelle').map((t) => t.genre)).toEqual(['releve'])
    expect(muter('src/lib/ecrituresVentesFacturees.ts', 'libelle: libelleDUnMouvementDesVentes(m.date, justifies.map(citee))',
      'libelle: `Relevé — ${m.libelle}`').map((t) => t.genre)).toEqual(['releve'])
    expect(muter('src/lib/fec.ts', 'auxiliaireDuTiers(tiersAuFec(piece), e.compte, modele)', 'auxiliaireDuTiers(piece ?? { tiers: null }, e.compte, modele)').length).toBe(1)
  })
})
