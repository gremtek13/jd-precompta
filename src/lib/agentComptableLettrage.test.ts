import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  COMPTE_AUTRES_DEBITEURS_CREDITEURS, COMPTE_BANQUE, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_EXPLOITANT,
  COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS,
} from './comptes'
import { auxiliaireDuTiers } from './engagement'
import { cleFournisseur } from './format'
import { etatsDesLettragesManuels, piecesLettreesALaMain, type MotifLettrageManuel } from './lettrage'
import type { EcritureBrouillon, LettrageManuel, ModeComptable, Piece } from './types'
import { NON_VALIDEE } from '../test/ecritures'

// L'ASSISTANT RECOPIE CE QUE LA CHECKLIST DIT DES LETTRAGES FAITS À LA MAIN (06/10/2026, ligne 32, seconde brique).
//
// En engagement, le cabinet peut lettrer à la main des pièces d'un même tiers qui se soldent entre elles sans
// mouvement bancaire — une facture et son avoir (lib/lettrage.ts). La Checklist en tire deux choses : les pièces d'un
// lettrage qui tient n'attendent aucun règlement, donc ne comptent pas parmi les « factures sans règlement
// rapproché » ; et un lettrage qui ne se solde plus est un point à traiter. `agent-comptable` est auto-portée : elle
// recopie la clé d'un tiers, son compte auxiliaire et la revérification de chaque lettrage entre les bornes
// `── DÉBUT/FIN LETTRAGE MANUEL`, et ce test les compare à `src/lib` — la forme de garde des autres blocs : extraire,
// transpiler, exécuter, comparer à une référence EXTÉRIEURE à la copie, et planter des dérives dans la vraie source
// pour prouver qu'il sait encore échouer.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant compterait « sans règlement rapproché » une facture que son avoir solde — et
// enverrait chercher à la banque un paiement qui n'existera jamais —, ou se tairait sur un lettrage qui ne tient plus,
// pendant que la Checklist le compte. En français, à un comptable qui n'ira pas vérifier.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

interface EtatCopie { groupe: string; pieceIds: string[]; motif: MotifLettrageManuel | null }
interface Copie {
  cleFournisseur: (tiers: string | null) => string | null
  auxiliaireDuTiers: (piece: { tiers: string | null }, compte: string) => string | null
  etatsDesLettragesManuels: (
    e: readonly EcritureBrouillon[], p: readonly Pick<Piece, 'id' | 'tiers'>[], lm: readonly LettrageManuel[], mode: ModeComptable,
  ) => EtatCopie[]
  piecesLettreesALaMain: (etats: readonly EtatCopie[]) => Set<string>
  MOTS_SANS_IDENTITE: Set<string>
}

// Le bloc lit les trois comptes de tiers déclarés avec la copie de src/lib/engagement.ts : repris de la MÊME source,
// pour qu'une dérive de l'un d'eux morde ici aussi.
function extraire(source: string): Copie {
  const debut = source.indexOf('// ── DÉBUT LETTRAGE MANUEL')
  const fin = source.indexOf('// ── FIN LETTRAGE MANUEL')
  expect(debut, 'bornes du bloc LETTRAGE MANUEL introuvables — garde-fou à remettre à jour').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  const comptes = ['COMPTE_FOURNISSEURS', 'COMPTE_FOURNISSEURS_IMMOBILISATIONS', 'COMPTE_CLIENTS'].map((nom) => {
    const declaration = new RegExp(`^const ${nom} = "(\\d+)"$`, 'm').exec(source)
    expect(declaration, `\`${nom}\` introuvable dans la source`).not.toBeNull()
    return declaration![0]
  })
  const bloc = `${comptes.join('\n')}\n${source.slice(debut, fin)}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { cleFournisseur, auxiliaireDuTiers, etatsDesLettragesManuels, piecesLettreesALaMain, MOTS_SANS_IDENTITE }`)() as Copie
}

const deployee = extraire(sourceDeployee())

// Les mots d'un `new Set([...])` nommé, lus dans un texte source : la liste de src/lib/format.ts n'est pas exportée, et
// c'est elle qui fait foi.
function motsDe(source: string, nom: string): string[] {
  const debut = source.indexOf(`const ${nom} = new Set([`)
  expect(debut, `\`${nom}\` introuvable`).toBeGreaterThan(-1)
  const corps = source.slice(debut, source.indexOf('])', debut))
  return [...corps.replace(/\/\/[^\n]*/g, '').matchAll(/['"]([a-z]+)['"]/g)].map((m) => m[1]).sort()
}

const ecriture = (o: Partial<EcritureBrouillon> & Pick<EcritureBrouillon, 'id'>): EcritureBrouillon => ({
  dossier_id: 'd1', piece_id: 'f', ligne_bancaire_id: null, date: '2026-03-10', compte: COMPTE_FOURNISSEURS, libelle: 'Fournisseur',
  montant: 500, sens: 'credit', statut: 'proposee', created_at: '2026-03-10T09:00:00Z', immobilisation_id: null,
  vehicule_id: null, ...NON_VALIDEE, ...o,
})
const manuel = (groupe: string, piece_id: string | null, o: Partial<LettrageManuel> = {}): LettrageManuel => ({
  id: `${groupe}-${piece_id ?? 'supprimee'}`, dossier_id: 'd1', groupe, piece_id, compte: COMPTE_FOURNISSEURS,
  created_at: '2026-05-02T08:00:00Z', ...o,
})
const piece = (id: string, tiers: string | null): Pick<Piece, 'id' | 'tiers'> => ({ id, tiers })

// Une facture de 500 € et l'avoir qui la solde, chacun avec sa charge et sa ligne de tiers — ce que la génération
// écrit en engagement. `avoir` : le montant de l'avoir sur le compte de tiers.
function brouillon(avoir = 500, compte = COMPTE_FOURNISSEURS): EcritureBrouillon[] {
  return [
    ecriture({ id: 'f1', piece_id: 'f', compte: '606100', sens: 'debit' }),
    ecriture({ id: 'f2', piece_id: 'f', compte }),
    ecriture({ id: 'a1', piece_id: 'a', compte: '606100', sens: 'credit', montant: avoir, date: '2026-03-20' }),
    ecriture({ id: 'a2', piece_id: 'a', compte, sens: 'debit', montant: avoir, date: '2026-03-20' }),
  ]
}
const groupe = [manuel('g1', 'f'), manuel('g1', 'a')]
const tiersMemes = [piece('f', 'Transmedical'), piece('a', 'TRANSMEDICAL / et redevient')]

// Chaque cas : le brouillon, les pièces lues, les lettrages, le modèle.
type Cas = [string, EcritureBrouillon[], Pick<Piece, 'id' | 'tiers'>[], LettrageManuel[], ModeComptable]
const CAS: Cas[] = [
  ['un lettrage qui tient', brouillon(), tiersMemes, groupe, 'engagement'],
  ['le même en trésorerie, où rien ne se lettre', brouillon(), tiersMemes, groupe, 'tresorerie'],
  ['une pièce supprimée depuis', brouillon(), tiersMemes, [manuel('g1', 'f'), manuel('g1', null)], 'engagement'],
  ['un lettrage qui n’apparie plus qu’une pièce', brouillon(), tiersMemes, [manuel('g1', 'f')], 'engagement'],
  ['des pièces lettrées sur deux comptes', brouillon(), tiersMemes, [manuel('g1', 'f'), manuel('g1', 'a', { compte: COMPTE_CLIENTS })], 'engagement'],
  ['un compte qui ne se lettre pas', brouillon(500, COMPTE_EXPLOITANT), tiersMemes,
    groupe.map((l) => ({ ...l, compte: COMPTE_EXPLOITANT })), 'engagement'],
  ['une pièce absente de la lecture', brouillon(), [tiersMemes[0]], groupe, 'engagement'],
  ['une pièce sans tiers identifié', brouillon(), [piece('f', null), piece('a', 'CARTE BANCAIRE')], groupe, 'engagement'],
  // Un fournisseur dont la clé finit par « divers » a son propre compte auxiliaire (FPRODIVERS) : comparé au numéro
  // exact, pas à sa fin.
  ['un fournisseur dont la clé finit par « divers »', brouillon(), [piece('f', 'Prodivers'), piece('a', 'PRODIVERS SARL')], groupe, 'engagement'],
  ['des pièces qui ne sont plus du même tiers', brouillon(), [piece('f', 'Transmedical'), piece('a', 'Bureau Vallée')], groupe, 'engagement'],
  // Le sigle pointé se recolle : « C.P.A.M. Marseille » et « CPAM » sont le même organisme, pas une ville.
  ['un sigle pointé', brouillon(), [piece('f', 'C.P.A.M. Marseille'), piece('a', 'CPAM')], groupe, 'engagement'],
  ['un mot qui ne désigne personne', brouillon(), [piece('f', 'Villa Estello'), piece('a', 'Estello')], groupe, 'engagement'],
  ['une pièce sans écriture sur le compte', brouillon().filter((e) => e.piece_id !== 'a'), tiersMemes, groupe, 'engagement'],
  ['une pièce soldée par ses règlements', [
    ...brouillon(),
    ecriture({ id: 'r1', piece_id: 'f', sens: 'debit', ligne_bancaire_id: 'm1', date: '2026-06-05' }),
    ecriture({ id: 'r2', piece_id: 'f', compte: COMPTE_BANQUE, ligne_bancaire_id: 'm1', date: '2026-06-05' }),
  ], tiersMemes, groupe, 'engagement'],
  ['une pièce soldée sur un autre compte de tiers', [
    ...brouillon(),
    ecriture({ id: 'x1', piece_id: 'f', compte: COMPTE_AUTRES_DEBITEURS_CREDITEURS, montant: 5 }),
    ecriture({ id: 'x2', piece_id: 'f', compte: COMPTE_AUTRES_DEBITEURS_CREDITEURS, sens: 'debit', montant: 5, ligne_bancaire_id: 'm9' }),
  ], tiersMemes, groupe, 'engagement'],
  ['des pièces qui ne se soldent plus', brouillon(400), tiersMemes, groupe, 'engagement'],
  // Des montants que les flottants représentent mal : 0,07 + 0,14 n'y font pas 0,21, la somme se juge en centimes.
  ['des montants au centime que les flottants représentent mal', [
    ecriture({ id: 'f2', piece_id: 'f', montant: 0.21 }),
    ecriture({ id: 'a2', piece_id: 'a', sens: 'debit', montant: 0.07 }),
    ecriture({ id: 'b2', piece_id: 'b', sens: 'debit', montant: 0.14 }),
  ], [...tiersMemes, piece('b', 'Transmedical')], [...groupe, manuel('g1', 'b')], 'engagement'],
  ['au compte du dirigeant, qui n’a pas de compte auxiliaire', brouillon(500, COMPTE_COURANT_ASSOCIE),
    [piece('f', 'Restaurant'), piece('a', 'Péage')], groupe.map((l) => ({ ...l, compte: COMPTE_COURANT_ASSOCIE })), 'engagement'],
  ['deux lettrages, l’un qui tient et l’autre non', [
    ...brouillon(),
    ecriture({ id: 'c2', piece_id: 'c', montant: 80 }),
    ecriture({ id: 'd2', piece_id: 'e', sens: 'debit', montant: 70 }),
  ], [...tiersMemes, piece('c', 'Bureau Vallée'), piece('e', 'Bureau Vallée')], [...groupe, manuel('g2', 'c'), manuel('g2', 'e')], 'engagement'],
]

// Les deux côtés rendus sous une forme comparable, et dans un ordre qui ne dépend que du lettrage : la copie ne calcule
// pas le libellé selon lequel src/lib range sa liste.
const forme = (etats: readonly { groupe: string; pieceIds: string[]; motif: string | null }[]) =>
  etats.map((e) => `${e.groupe}:${e.pieceIds.join(',')}:${e.motif ?? 'tient'}`).sort()

const ici = ([, b, p, lm, mode]: Cas) => etatsDesLettragesManuels(b, p, lm, mode)
const la = (copie: Copie, [, b, p, lm, mode]: Cas) => copie.etatsDesLettragesManuels(b, p, lm, mode)

const TIERS = [
  null, '', 'Transmedical', 'Transmedical / et redevient', 'TRANSMEDICAL', 'C.P.A.M. Marseille', 'CPAM', 'E.D.F.', 'EDF',
  'www.edf.fr', 'Cabinet X. Y. Martin', 'Villa Estello', 'Institut Pasteur', 'Siège Institut national de la propriété industrielle',
  'RESPONSABILITÉ CIVILE PROFESSIONNELLE / PROTECTION / JURIDIQUE', 'CARTE BANCAIRE', 'Café Martin', 'Cafe Martin', 'ulys',
  'Bureau Vallée', 'Divers', 'Prodivers', 'SARL Société Générale de Matériel',
]
const COMPTES = [
  COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE,
  COMPTE_AUTRES_DEBITEURS_CREDITEURS, COMPTE_EXPLOITANT,
]

describe('agent-comptable / bloc LETTRAGE MANUEL (copie déployée)', () => {
  it('n’est pas la fonction de src/lib elle-même', () => {
    expect(deployee.etatsDesLettragesManuels).not.toBe(etatsDesLettragesManuels)
    expect(deployee.piecesLettreesALaMain).not.toBe(piecesLettreesALaMain)
    expect(deployee.cleFournisseur).not.toBe(cleFournisseur)
  })

  it('écarte les mêmes mots que src/lib, ni plus ni moins', () => {
    const src = readFileSync(new URL('./format.ts', import.meta.url), 'utf8')
    expect([...deployee.MOTS_SANS_IDENTITE].sort()).toEqual(motsDe(src, 'MOTS_SANS_IDENTITE'))
    // Et la lecture de la source n'est pas aveugle : la liste a bien été lue.
    expect(motsDe(src, 'MOTS_SANS_IDENTITE').length).toBeGreaterThan(30)
  })

  it('tire la même clé de chaque tiers, et le même compte auxiliaire sur chaque compte', () => {
    for (const tiers of TIERS) {
      expect(deployee.cleFournisseur(tiers), `${tiers}`).toBe(cleFournisseur(tiers))
      for (const compte of COMPTES) {
        expect(deployee.auxiliaireDuTiers({ tiers }, compte), `${tiers} au ${compte}`).toBe(auxiliaireDuTiers({ tiers }, compte)?.num ?? null)
      }
    }
  })

  it('dit de chaque lettrage la même chose que la Checklist', () => {
    for (const c of CAS) expect(forme(la(deployee, c)), c[0]).toEqual(forme(ici(c)))
  })

  it('retire les mêmes pièces des factures sans règlement', () => {
    for (const c of CAS) {
      expect([...deployee.piecesLettreesALaMain(la(deployee, c))].sort(), c[0]).toEqual([...piecesLettreesALaMain(ici(c))].sort())
    }
  })

  it('la batterie exerce bien ce qui décide', () => {
    // Sans ces résultats attendus, une batterie qui ne déclencherait rien laisserait les deux copies « d'accord » sur
    // des listes vides — ou sur un seul motif.
    const motifs = new Set(CAS.flatMap((c) => ici(c).map((e) => e.motif ?? 'tient')))
    expect([...motifs].sort()).toEqual([
      'comptes_differents', 'ne_se_solde_plus', 'piece_lettree_ailleurs', 'piece_non_lue', 'piece_soldee_seule',
      'piece_supprimee', 'sans_ecriture', 'tient', 'tiers_differents', 'tiers_non_identifie', 'une_seule_piece',
    ])
    const cas = (nom: string) => forme(ici(CAS.find(([n]) => n === nom)!))
    expect(cas('un sigle pointé')).toEqual(['g1:a,f:tient'])
    expect(cas('un mot qui ne désigne personne')).toEqual(['g1:a,f:tient'])
    expect(cas('un fournisseur dont la clé finit par « divers »')).toEqual(['g1:a,f:tient'])
    expect(cas('des montants au centime que les flottants représentent mal')).toEqual(['g1:a,b,f:tient'])
    expect(cas('au compte du dirigeant, qui n’a pas de compte auxiliaire')).toEqual(['g1:a,f:tient'])
    expect(cas('le même en trésorerie, où rien ne se lettre')).toEqual([])
  })
})

describe('agent-comptable / points_a_traiter lit les lettrages faits à la main', () => {
  const source = sourceDeployee()
  const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))

  it('lit les lettrages et le tiers de toutes les pièces, sous le même refus de lecture partielle', () => {
    expect(corps).toMatch(/admin\.from\("lettrages_manuels"\)\.select\("id, groupe, piece_id, compte", \{ count: "exact" \}\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(corps).toMatch(/admin\.from\("pieces"\)\.select\("id, date_piece, tiers, [^"]*"[^)]*\)\.eq\("dossier_id", dossierId\)\.eq\("statut", "validee"\)/)
    expect(corps).toMatch(/admin\.from\("pieces"\)\.select\("id, tiers, confiance"[^)]*\)\.eq\("dossier_id", dossierId\)\.eq\("statut", "a_valider"\)/)
    expect(corps).toMatch(/, rValides, rLettrages\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  it('retire des factures sans règlement les pièces d’un lettrage qui tient, et compte ceux qui ne se soldent plus', () => {
    // TOUTES les pièces, validées ou non, comme la Checklist : une pièce absente ferait dire « pièce non lue » d'un
    // lettrage juste.
    expect(corps).toContain('const etatsLettrages = etatsDesLettragesManuels(ecrituresTyped, [...piecesTyped, ...piecesAValider], rLettrages.lignes, modele.mode)')
    expect(corps).toContain('const lettreesALaMain = piecesLettreesALaMain(etatsLettrages)')
    expect(corps).toContain('const sansReglement = piecesSansContrepartie.filter((id) => !lettreesALaMain.has(id)).length')
    expect(corps).toMatch(/factures_sans_reglement_rapproche: sansReglement,/)
    expect(corps).toMatch(/lettrages_faits_a_la_main_qui_ne_se_soldent_plus: etatsLettrages\.filter\(\(e\) => e\.motif !== null\)\.length,/)
    expect(corps).toMatch(/: \{ ecritures_en_attente_de_rapprochement_bancaire: sansReglement \}/)
  })

  it('nomme le point dans la description de l’outil, que le modèle lit avant de l’appeler', () => {
    expect(source).toContain("et en engagement les factures sans règlement rapproché — hors celles qu'un lettrage fait à la main solde avec leur avoir — et les lettrages faits à la main qui ne se soldent plus.")
  })

  it('dit au modèle, en engagement, qu’une facture lettrée à la main n’attend aucun règlement', () => {
    expect(source).toContain(
      '${dossierRow.mode_comptable === "engagement" ? "\\n- Des pièces d\'un même tiers peuvent être LETTRÉES À LA MAIN (une facture et l\'avoir qui la solde, sans mouvement bancaire) : elles n\'attendent aucun règlement, ce n\'est pas une anomalie. Un lettrage fait à la main qui ne se solde plus (points_a_traiter) n\'est pas porté au FEC, et la facture qu\'il soldait reparaît ouverte : la liste « Lettrages faits à la main », sous les comptes de tiers de la Balance des comptes, dit pourquoi et le défait." : ""}',
    )
  })
})

describe('le garde-fou du bloc LETTRAGE MANUEL sait encore échouer', () => {
  // Une ancre qui figurerait deux fois ferait planter la dérive au mauvais endroit : on l'exige unique.
  function planter(avant: string, apres: string, quoi: string): Copie {
    const source = sourceDeployee()
    expect(source.split(avant).length - 1, `${quoi} introuvable ou ambiguë — la dérive plantée ne mord plus`).toBe(1)
    return extraire(source.replace(avant, apres))
  }
  const cas = (nom: string) => CAS.find(([n]) => n === nom)!
  const diverge = (copie: Copie, nom: string) => expect(forme(la(copie, cas(nom)))).not.toEqual(forme(ici(cas(nom))))

  it('attrape une copie qui ne vérifie plus que les pièces sont du même tiers', () => {
    const derivee = planter(
      '    else if (new Set(auxiliaires.map((a) => a ?? "")).size > 1) motif = "tiers_differents"\n', '',
      'la garde du même tiers',
    )
    diverge(derivee, 'des pièces qui ne sont plus du même tiers')
  })

  it('attrape une copie qui laisse passer le compte « divers »', () => {
    const derivee = planter(
      '    else if (auxiliaires.some((a) => a !== null && estDivers(compte, a))) motif = "tiers_non_identifie"\n', '',
      'la garde du compte « divers »',
    )
    diverge(derivee, 'une pièce sans tiers identifié')
  })

  it('attrape une copie qui reconnaît le compte « divers » à sa fin plutôt qu’à son numéro', () => {
    const derivee = planter(
      '  return auxiliaire === auxiliaireDuTiers({ tiers: null }, compte)\n', '  return auxiliaire.endsWith("DIVERS")\n',
      'la comparaison au numéro exact',
    )
    diverge(derivee, 'un fournisseur dont la clé finit par « divers »')
  })

  it('attrape une copie qui juge la somme en flottants', () => {
    const derivee = planter(
      '(e.sens === "debit" ? 1 : -1) * Math.round(e.montant * 100)\n', '(e.sens === "debit" ? 1 : -1) * e.montant * 100\n',
      'les centimes du bloc',
    )
    diverge(derivee, 'des montants au centime que les flottants représentent mal')
  })

  it('attrape une copie qui ne recolle plus les sigles pointés', () => {
    const derivee = planter(
      '  return texte.replace(SIGLE_POINTE, (sigle) => sigle.replace(/\\./g, ""))\n', '  return texte\n', 'le recollement des sigles',
    )
    diverge(derivee, 'un sigle pointé')
  })

  it('attrape une copie à qui manque un mot qui ne désigne personne', () => {
    const derivee = planter('  "restaurant", "villa",\n', '  "restaurant",\n', 'le mot « villa »')
    diverge(derivee, 'un mot qui ne désigne personne')
  })

  it('attrape une copie qui laisse une pièce se solder à la fois seule et à la main', () => {
    const derivee = planter(
      '    else if (pieceIds.some((id) => soldeesSeules.has(id))) motif = "piece_lettree_ailleurs"\n', '',
      'la garde d’un lettrage par pièce',
    )
    diverge(derivee, 'une pièce soldée sur un autre compte de tiers')
  })

  it('attrape une copie qui retire de « sans règlement » les pièces d’un lettrage qui ne tient plus', () => {
    const derivee = planter(
      '  return new Set(etats.filter((e) => e.motif === null).flatMap((e) => e.pieceIds))\n',
      '  return new Set(etats.flatMap((e) => e.pieceIds))\n',
      'le filtre des lettrages qui tiennent',
    )
    const c = cas('des pièces qui ne se soldent plus')
    expect([...derivee.piecesLettreesALaMain(la(derivee, c))].sort()).not.toEqual([...piecesLettreesALaMain(ici(c))].sort())
  })

  it('attrape une copie qui lettre aussi en trésorerie', () => {
    const derivee = planter('  if (mode !== "engagement") return []\n  const pieceById', '  const pieceById', 'la garde du modèle')
    diverge(derivee, 'le même en trésorerie, où rien ne se lettre')
  })

  it('et il ne crie PAS au loup sur la copie réellement déployée', () => {
    // Garde symétrique : sans lui, « la dérive est attrapée » serait satisfait par un garde-fou dont la comparaison
    // échouerait sur tout.
    for (const c of CAS) expect(forme(la(deployee, c)), c[0]).toEqual(forme(ici(c)))
  })
})
