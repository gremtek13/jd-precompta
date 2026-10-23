import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  LONGUEUR_MAXIMALE_NOTE, LONGUEUR_MAXIMALE_PLATEFORME, OBJETS_DECLARES, REFUS_DECLARATION, REFUS_SUPPRESSION_PIECE,
  SOURCES_ATTENDUES, TAILLE_MAXIMALE_CONTENU, VERSION_DU_CONTENU, argumentsDeLaDeclaration, contenuADeclarer,
  dateCivileStricte, declarationActive, declarationQuiRetientLaPiece, empreinteDuContenu, etatDeLaDeclaration,
  formeCanonique, refusDeclaration, tailleDuContenu, uuidCommeLaBase, type ContenuDuCalcul, type ContexteDeLaDeclaration,
  type ContexteDesCauses, type SaisieDeclaration,
} from './declarationsEreporting'
import {
  declarationDesAchats, declarationDesPaiements, declarationDesVentes, type AchatDeclare, type ContenuAchats,
  type ContenuVentes, type DeclarationEreporting, type DossierEreporting, type EcartLu, type EncaissementLu,
  type FactureLue, type Lecture, type LigneLue, type PartLue, type PieceLue, type RefusEreporting, type TexteDePiece,
  type TransactionsDuJour,
} from './ereporting'
import { ajouterJours, ajouterMois, dernierJourDuMois } from './format'
import { DEBUT_EREPORTING_PME, periodeDe, type FrequenceEreporting } from './periodesEreporting'
import { rythme, type LigneDeRegime } from './regimesEreporting'
import type {
  DeclarationEreportingHorsApplication, FactureEmise, PieceHorsDeFrance, PieceHorsDeFranceTaux, RegimeEreporting,
} from './types'
import { appelsDe, commeLaBase, decouper, etapesDe, lignesInserees, remplacerLesNoms, type Etape } from '../test/essaiSql'
import { argumentsSql, codesSql, messagesSql } from '../test/raiseSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LA DÉCLARATION D'E-REPORTING HORS APPLICATION (ligne 28.5, étape e5b1), confrontée à ce qui fait foi : la migration
// `declarations_ereporting` — le texte de `declarer_ereporting_hors_application` et de `garder_piece_declaree` que
// l'export porte — pour l'ordre et les mots des refus, leurs valeurs, leurs codes et les paramètres ; l'essai
// (supabase/essais/declarationsEreporting.sql) pour ce que la base a RÉPONDU : chacun de ses appels à la fonction est
// rejoué ici, sur le même jeu et dans le même ordre, et le module doit dire ce que la base a dit — le refus, au mot près,
// ou rien quand elle a accepté ; et deux tables relevées sur la réplique de l'étape le 11/10/2026 : la grille de la
// période d'e1 portée en SQL (contrôle 87 de l'essai), et le texte et l'empreinte que la base garde de contenus choisis
// pour leurs bords. CHAQUE AUTRE ATTENDU EST ÉCRIT À LA MAIN, depuis la source que cite la ligne qui le précède :
//   [DG]  spécifications externes de la DGFiP v3.2, dossier général, § 3.7.7 (note 127 : la rectificative « annule et
//         remplace l'ensemble des données agrégées et précédemment transmises au titre de cette période ») ;
//   [G]   annexe 7 v1.9 : G6.29 et G7.52 (un rôle de déclarant par fichier), G7.43 (une période finie avant le contrôle) ;
//   [B]   BOI-TVA-DECLA-20-30-50, § 10 (les factures du 01/09/2027 et après, pour une PME) ; BOI-TVA-DECLA-20-30-50-30,
//         § 80, et CGI, ann. II, art. 242 nonies O (pas de transmission sans opération) ;
//   [C]   la conception d'e5b (HISTORIQUE.md, « LE RÉGIME D'E-REPORTING CONFIRMÉ ET LA PIÈCE ÉCARTÉE, EN BASE ») : § 1, une
//         seule active par période, le contenu figé et son empreinte ; § 3, la fiche déclarée retient sa pièce (E5-Q6),
//         un régime retiré, un écart retiré, une fiche posée après : « à rectifier », jamais un refus (E5-Q7).

const ESSAI = readFileSync(new URL('../../supabase/essais/declarationsEreporting.sql', import.meta.url), 'utf8')
const SQL = derniereDefinitionSql('declarer_ereporting_hors_application')
const PLAT = SQL.replace(/\s+/g, ' ')

// Le jour de Paris sous lequel le rejeu juge l'essai : un jour où sa partie B se joue (à partir du 01/11/2027), celui de
// la réplique dont l'horloge a été avancée.
const AUJOURD_HUI = '2027-11-15'

function migration(): string {
  const f = fichiersDuSchema().find((x) => x.texte.includes('create table public.declarations_ereporting ('))
  expect(f, 'la migration des déclarations dans l’export').toBeDefined()
  return (f?.texte ?? '').replace(/\s+/g, ' ')
}

// Des identifiants que la base lit (le module les compare sous leur forme canonique).
const u = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const D = u(1)
const D2 = u(2)
const R = u(10)
const P1 = u(21)
const P2 = u(22)
const P3 = u(23)
const PX = u(29)
const F1 = u(31)
const F1B = u(32)
const F2 = u(33)
const F3 = u(34)
const FX = u(39)
const FV = u(41)
const FB = u(42)
const FX2 = u(49)
const E1 = u(51)
const EX = u(59)

const lu = <T>(lignes: T[]): Lecture<T> => ({ lignes, complete: true, motif: null })

// Un redevable au réel trimestriel depuis le 1er janvier 2026 : chaque mois, ventes, achats et paiements [B].
function regime(o: Partial<LigneDeRegime> = {}): LigneDeRegime {
  return {
    id: R, dossier_id: D, depuis: '2026-01-01', statut_tva: 'redevable', article_exoneration: null,
    tva_periodicite: 'trimestrielle', tva_sur_debits: false, frequence_transactions: 'mois', frequence_paiements: 'mois',
    retire_le: null, ...o,
  }
}

type Ligne = ContexteDeLaDeclaration['declarations'][number]
function declaration(o: Partial<Ligne> = {}): Ligne {
  return { id: u(100), dossier_id: D, objet: 'achats', periode_debut: '2027-09-01', periode_fin: '2027-09-30', etat: 'declaree', plateforme: 'Plateforme A', ...o }
}

// Le dossier D : une pièce d'achat et sa fiche, une seconde pièce et la sienne, une facture validée et un brouillon, un
// encaissement ; une pièce et sa fiche dans un autre dossier. Le 15/11/2027.
function contexte(o: Partial<ContexteDeLaDeclaration> = {}): ContexteDeLaDeclaration {
  return {
    dossierId: D, regimes: [regime()], declarations: [], sources: [],
    fiches: [{ id: F1, dossier_id: D, piece_id: P1 }, { id: F2, dossier_id: D, piece_id: P2 }, { id: FX, dossier_id: D2, piece_id: PX }],
    pieces: [{ id: P1, dossier_id: D }, { id: P2, dossier_id: D }, { id: PX, dossier_id: D2 }],
    factures: [{ id: FV, dossier_id: D, statut: 'validee' }, { id: FB, dossier_id: D, statut: 'brouillon' }, { id: FX2, dossier_id: D2, statut: 'validee' }],
    encaissements: [{ id: E1, dossier_id: D }, { id: EX, dossier_id: D2 }],
    aujourdHui: AUJOURD_HUI, ...o,
  }
}

const achat = (ficheId: string, pieceId: string, date = '2027-09-10') => ({ ficheId, pieceId, date })
function contenuAchats(achats: unknown[], o: Record<string, unknown> = {}) {
  return { version: 1, objet: 'achats', debut: '2027-09-01', fin: '2027-09-30', role: 'BY', achats, nombreOperations: achats.length, ...o }
}
function contenuVentes(transactions: { date: string; factures: unknown[] }[], o: Record<string, unknown> = {}) {
  return {
    version: 1, objet: 'ventes', debut: '2027-09-01', fin: '2027-09-30', role: 'SE', transactions,
    nombreOperations: transactions.reduce((n, t) => n + t.factures.length, 0), ...o,
  }
}
function contenuPaiements(paiements: { date: string; encaissements: unknown[] }[], o: Record<string, unknown> = {}) {
  return {
    version: 1, objet: 'paiements', debut: '2027-09-01', fin: '2027-09-30', role: 'SE', paiements,
    nombreOperations: paiements.reduce((n, p) => n + p.encaissements.length, 0), ...o,
  }
}

// Les achats de septembre 2027, déclarés le 15/11/2027 sur la plateforme du dossier : ce que la base accepte.
function saisie(o: Partial<SaisieDeclaration> = {}): SaisieDeclaration {
  return {
    objet: 'achats', debut: '2027-09-01', fin: '2027-09-30', regimeId: R, remplaceId: null, plateforme: 'Plateforme A',
    contenu: contenuAchats([achat(F1, P1)]), note: null, ...o,
  }
}

const refus = (s: Partial<SaisieDeclaration> = {}, c: Partial<ContexteDeLaDeclaration> = {}) => refusDeclaration(saisie(s), contexte(c))
const cle = (s: Partial<SaisieDeclaration> = {}, c: Partial<ContexteDeLaDeclaration> = {}) => refus(s, c)?.cle ?? null

// ── La fonction, confrontée à son texte ─────────────────────────────────────────────────────────────────────────────

describe('declarer_ereporting_hors_application — le module dit ses refus, dans leur ordre et sous leurs mots', () => {
  it('les mêmes messages et les mêmes codes, dans l’ordre du texte', () => {
    expect(messagesSql(SQL)).toEqual(REFUS_DECLARATION.map((r) => r.modele))
    expect(codesSql(SQL)).toEqual(REFUS_DECLARATION.map((r) => r.code))
    expect(REFUS_DECLARATION.filter((r) => r.code === 'P0002').map((r) => r.cle)).toEqual(['regime_introuvable', 'remplacee_introuvable'])
  })

  it('les valeurs des « % » : les jours en JJ/MM/AAAA, le rythme, la plateforme, le nombre, la source attendue', () => {
    const valeurs = argumentsSql(SQL)
    const rang = (c: string) => REFUS_DECLARATION.findIndex((r) => r.cle === c)
    const jour = (x: string) => `to_char(${x}, 'DD/MM/YYYY')`
    const attendues: Record<string, string[]> = {
      regime_posterieur: [jour('v_regime.depuis')],
      regime_depasse: [jour('p_debut'), jour('v_suivant.depuis')],
      regime_change: [jour('v_suivant.depuis')],
      periode_hors_regime: [jour('p_debut'), jour('p_fin'),
        "case v_frequence when 'decade' then 'par décade' when 'mois' then 'chaque mois' else 'tous les deux mois' end"],
      avant_l_obligation: [jour('p_fin')],
      chevauchement: [jour('v_autre.periode_debut'), jour('v_autre.periode_fin')],
      deja_declaree: ['v_active.plateforme'],
      operation_hors_periode: [jour('v_date')],
      nombre_operations: ['v_nombre'],
      source_inconnue: ["case p_objet when 'achats' then 'la fiche « fournisseur établi hors de France » d''une pièce' "
        + "when 'ventes' then 'une facture validée' else 'un encaissement' end"],
      source_deja_declaree: [jour('v_autre.periode_debut'), jour('v_autre.periode_fin')],
      periode_en_cours: [jour('p_fin + 1')],
    }
    for (const r of REFUS_DECLARATION) expect(valeurs[rang(r.cle)], r.cle).toEqual(attendues[r.cle] ?? [])
  })

  it('le rythme et la source attendue sont ceux que le module écrit', () => {
    // [B] : par décade, chaque mois, tous les deux mois — les mots d'e5a, que la fonction recopie.
    const frequences: FrequenceEreporting[] = ['decade', 'mois', 'bimestre']
    for (const f of frequences) expect(PLAT).toContain(f === 'bimestre' ? `else '${rythme(f)}' end` : `when '${f}' then '${rythme(f)}'`)
    expect(PLAT).toContain(`when 'achats' then '${SOURCES_ATTENDUES.achats.replace(/'/g, "''")}'`)
    expect(PLAT).toContain(`when 'ventes' then '${SOURCES_ATTENDUES.ventes}' else '${SOURCES_ATTENDUES.paiements}' end`)
  })

  it('les paramètres, dans l’ordre de sa signature', () => {
    const parametres = (/function public\.\w+\(([^)]*)\)/.exec(SQL)?.[1] ?? '').split(',').map((p) => p.trim().split(/\s+/)[0])
    expect(parametres).toHaveLength(9)
    expect(Object.keys(argumentsDeLaDeclaration(D, saisie()))).toEqual(parametres)
  })

  it('les règles que le module refait sont celles du texte de la fonction et de la table', () => {
    const table = migration()
    // Le jour à Paris [G] G7.43, la fin au 01/09/2027 ou après [B], une note faite d'espaces n'est pas une note.
    expect(PLAT).toContain("v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;")
    expect(PLAT).toContain('if p_fin >= v_aujourd_hui then')
    expect(PLAT).toContain(`if p_fin < date '${DEBUT_EREPORTING_PME}' then`)
    expect(PLAT).toContain("v_note text := case when btrim(p_note) = '' then null else p_note end;")
    // Les objets, dans l'ordre de la fonction ; le rôle du déclarant [G] G6.29 ; où chaque contenu range ses opérations.
    expect(PLAT).toContain(`p_objet not in (${OBJETS_DECLARES.map((o) => `'${o}'`).join(', ')})`)
    expect(table).toContain(`check (objet in (${OBJETS_DECLARES.map((o) => `'${o}'`).join(', ')}))`)
    expect(PLAT).toContain("p_contenu ->> 'role' is distinct from (case when p_objet = 'achats' then 'BY' else 'SE' end)")
    expect(PLAT).toContain("v_cle := case p_objet when 'achats' then 'achats' when 'ventes' then 'transactions' else 'paiements' end;")
    expect(PLAT).toContain("v_liste := case p_objet when 'ventes' then 'factures' when 'paiements' then 'encaissements' end;")
    expect(PLAT).toContain("case p_objet when 'achats' then 'fiche' when 'ventes' then 'facture' else 'encaissement' end, x")
    // Les bornes : la taille du contenu, la plateforme et la note, dans la fonction ET dans la table.
    expect(PLAT).toContain(`if octet_length(p_contenu::text) > ${TAILLE_MAXIMALE_CONTENU} then`)
    expect(table).toContain(`check (jsonb_typeof(contenu) = 'object' and octet_length(contenu::text) <= ${TAILLE_MAXIMALE_CONTENU})`)
    expect(PLAT).toContain(`if length(p_plateforme) > ${LONGUEUR_MAXIMALE_PLATEFORME} then`)
    expect(table).toContain(`check (btrim(plateforme) <> '' and length(plateforme) <= ${LONGUEUR_MAXIMALE_PLATEFORME})`)
    expect(PLAT).toContain(`if length(v_note) > ${LONGUEUR_MAXIMALE_NOTE} then`)
    expect(table).toContain(`check (btrim(note) <> '' and length(note) <= ${LONGUEUR_MAXIMALE_NOTE})`)
    // Le nombre d'opérations se compare en JSON : un texte « 1 » n'est pas le nombre 1.
    expect(PLAT).toContain("if (p_contenu -> 'nombreOperations') is distinct from to_jsonb(v_nombre) then")
    // L'empreinte, calculée par la base sur le texte du jsonb, dans la fonction et dans la garde.
    expect(PLAT).toContain("encode(sha256(convert_to(p_contenu::text, 'UTF8')), 'hex')")
    expect(table).toContain("if new.empreinte is distinct from encode(sha256(convert_to(new.contenu::text, 'UTF8')), 'hex') then")
  })

  it('la garde de la pièce déclarée : le même refus, les mêmes valeurs (hypothèse E5-Q6)', () => {
    const garde = derniereDefinitionSql('garder_piece_declaree')
    expect(messagesSql(garde)).toEqual([REFUS_SUPPRESSION_PIECE])
    expect(codesSql(garde)).toEqual(['23514'])
    expect(argumentsSql(garde)).toEqual([["to_char(v_declaration.periode_debut, 'DD/MM/YYYY')", "to_char(v_declaration.periode_fin, 'DD/MM/YYYY')"]])
    // La première active par sa période, la source d'une déclaration du dossier de la fiche.
    expect(garde.replace(/\s+/g, ' ')).toContain("where f.piece_id = old.id and d.etat = 'declaree' order by d.periode_debut, d.id limit 1;")
    expect(garde.replace(/\s+/g, ' ')).toContain("s.genre = 'fiche' and s.source_id = f.id and s.dossier_id = f.dossier_id")
  })
})

// ── La période d'e1, portée en SQL ──────────────────────────────────────────────────────────────────────────────────

describe('periode_ereporting rend la période de periodeDe (e1)', () => {
  const etape = (numero: string) => {
    const e = etapesDe(ESSAI).find((x) => x.numero === numero)
    expect(e, numero).toBeDefined()
    return e as Etape
  }

  it('chaque jour de 2026 à 2030 sous les trois fréquences : l’empreinte que la base a rendue (contrôle 87)', () => {
    const jours: string[] = []
    for (let j = '2026-01-01'; j <= '2030-12-31'; j = ajouterJours(j, 1)) jours.push(j)
    const lignes: string[] = []
    // L'ordre du contrôle : la fréquence (en texte), puis le jour.
    for (const f of ['bimestre', 'decade', 'mois'] as const) {
      for (const j of jours) {
        const p = periodeDe(j, f)
        lignes.push(`${f}:${j}:${p?.debut}:${p?.fin}`)
      }
    }
    expect(lignes).toHaveLength(5478)
    const attendu = etape('87').attendu
    expect(attendu).toMatch(/^[0-9a-f]{32}$/)
    expect(createHash('md5').update(lignes.join(',')).digest('hex')).toBe(attendu)
  })

  it('ses bords, comme la base les a rendus (contrôle 87b)', () => {
    const e = etape('87b')
    const rendus = [...e.appel.matchAll(/periode_ereporting\('([\d-]+)', '(\w+)'\)/g)].map(([, jour, f]) => {
      const p = ['decade', 'mois', 'bimestre'].includes(f) ? periodeDe(jour, f as FrequenceEreporting) : null
      return p == null ? '-/-' : `${p.debut}/${p.fin}`
    })
    expect(rendus.join(',')).toBe(e.attendu)
  })
})

// ── La forme canonique ──────────────────────────────────────────────────────────────────────────────────────────────

describe('formeCanonique — le texte que la base garde d’un contenu, et son empreinte', () => {
  // Relevé sur la réplique de l'étape le 11/10/2026 : chaque valeur envoyée par `JSON.stringify`, puis `x::jsonb::text`, sa
  // longueur en octets et `encode(sha256(convert_to(x::text, 'UTF8')), 'hex')`.
  const RELEVE: [unknown, number, string][] = [
    [{}, 2, '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'],
    [[], 2, '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'],
    [{ bb: 1, a: 2, 'é': 3, ab: 4, 'ä': 5, z: 6, '€': 7, aaa: 8, zz: 9, '😀': 10 }, 93,
      '37fdfb152eaf201cb9dac73fa905ffb6b699059b7fa61d7b39fce98e43e091e5'],
    [{ s: 'a"b\\c\u0001d\te\nf\rg\bh\fi/j\u001fk\u007fl m' }, 53, 'f56ef3b6978fb399e19192cf7336946f2bc5b7f46bb687561259daf6d33c40ea'],
    [{ emoji: '😀 — é€', cle: 'ﬁ', vide: '' }, 53, '9a43f9875dd846cae01177b68d958b3c5b4e022ee9212bcba479f30bf381cdaa'],
    [{ n: [0, -0, 1.5, 0.1, -3, 1e-7, 1.5e-7, -2.5e-8, 1e21, 1.2345e25, 123456789.123, 2 ** 53, 0.30000000000000004, 5e-324, 1.7976931348623157e308] },
      809, 'ffcbeb7570429a2be47baa5e462b7584b55be2c0d11d97c43bdf7ef27365c3f1'],
    [{ a: [[], {}, [1, [2, { k: null }]], true, false, null], b: { kk: null, k: true } }, 87,
      'ce53dac4c92e225156b9cdb6b14dcdc4322f65511a626dfedd312292eb24e0ae'],
    [{
      version: 1, objet: 'achats', debut: '2027-09-01', fin: '2027-09-30', role: 'BY', siren: null, numeroTva: null,
      achats: [{
        ficheId: 'b9c3b1f0-0000-4000-8000-000000000001', pieceId: 'b9c3b1f0-0000-4000-8000-000000000002', date: '2027-09-10',
        numero: 'INV-1', taux: 5.5, lignes: [{ code: 'AE', taux: 0, baseCentimes: 10000, tvaCentimes: 0, motifCode: null, motifTexte: null }],
      }],
      nombreOperations: 1,
    }, 437, 'e4af821e534bf1aee822be2545729ae6730585814a42082adbe218dc6126b47b'],
  ]

  it('le même texte et la même empreinte que la base, pour chaque valeur relevée', async () => {
    for (const [valeur, octets, empreinte] of RELEVE) {
      expect(tailleDuContenu(valeur), formeCanonique(valeur)).toBe(octets)
      expect(await empreinteDuContenu(valeur), formeCanonique(valeur)).toBe(empreinte)
    }
  })

  it('l’ordre des clés et les séparateurs de la base, lus en clair', () => {
    // Les clés par longueur en OCTETS, puis octet par octet : « ä » et « é » (deux octets) après « zz », « € » (trois) après « aaa ».
    expect(formeCanonique(RELEVE[2][0])).toBe('{"a": 2, "z": 6, "ab": 4, "bb": 1, "zz": 9, "ä": 5, "é": 3, "aaa": 8, "€": 7, "😀": 10}')
    expect(formeCanonique(RELEVE[6][0])).toBe('{"a": [[], {}, [1, [2, {"k": null}]], true, false, null], "b": {"k": true, "kk": null}}')
    // Un nombre sans exposant, comme `numeric` l'écrit ; « -0 » est « 0 ».
    expect(formeCanonique([1e-7, -2.5e-8, 1e21, -0, 1.5])).toBe('[0.0000001, -0.000000025, 1000000000000000000000, 0, 1.5]')
    // Les échappements de la base : six courts, les autres caractères de commande en \u00xx minuscules, « / » tel quel.
    expect(formeCanonique('a"b\\c\u0001\u001f/\u007f')).toBe('"a\\"b\\\\c\\u0001\\u001f/\u007f"')
    // Une valeur sans JSON disparaît d'un objet et devient « null » dans un tableau, comme `JSON.stringify`.
    expect(formeCanonique({ a: undefined, b: () => 1, c: [undefined] })).toBe('{"c": [null]}')
    expect(formeCanonique({ d: new Date('2027-09-10T00:00:00Z') })).toBe('{"d": "2027-09-10T00:00:00.000Z"}')
  })

  it('les contenus que l’essai insère par la porte de la restauration portent l’empreinte que le module calcule', async () => {
    // Les noms que l'essai retient en chemin ne comptent pas ici : seuls le contenu et son empreinte se comparent.
    const noms = nomsDeLEssai(ESSAI)
    for (const m of ESSAI.matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)) if (!noms.has(m[1])) noms.set(m[1], m[1])
    let vus = 0
    for (const e of etapesDe(ESSAI)) {
      for (const l of lignesInserees(e.appel, 'declarations_ereporting', noms)) {
        if (l.empreinte === '0'.repeat(64)) continue
        expect(await empreinteDuContenu(l.contenu), `${e.titre} : ${formeCanonique(l.contenu)}`).toBe(l.empreinte)
        vus++
      }
    }
    // Les huit du jeu (DA, DB, DC1, DP, DD, DE, DC2, DP2) et les écritures directes de la partie A (40 à 46j).
    expect(vus).toBeGreaterThanOrEqual(25)
  })

  it('ce que la base ne garde pas se refuse : une demi-paire de substitution, le caractère nul', () => {
    expect(() => formeCanonique({ x: '\ud800' })).toThrow(/demi-paire/)
    expect(() => formeCanonique({ x: 'a\udc00' })).toThrow(/demi-paire/)
    expect(() => formeCanonique({ x: 'a\u0000b' })).toThrow(/caractère nul/)
    expect(() => formeCanonique({ x: 1n })).toThrow()
  })

  it('la taille se compte en octets : « é » en vaut deux', () => {
    // {"x": "é"} : neuf caractères, onze octets.
    expect(tailleDuContenu({ x: 'é' })).toBe(11)
    expect(tailleDuContenu({ bourre: 'b'.repeat(1_048_562) })).toBe(TAILLE_MAXIMALE_CONTENU)
  })
})

// ── Ce que la base lit d'une date et d'un identifiant ───────────────────────────────────────────────────────────────

describe('dateCivileStricte et uuidCommeLaBase — ce que la base lit', () => {
  it('une date AAAA-MM-JJ du calendrier grégorien, l’an 0 excepté (relevé sur la réplique)', () => {
    expect(dateCivileStricte('2028-02-29')).toBe('2028-02-29')
    expect(dateCivileStricte('0001-01-01')).toBe('0001-01-01')
    for (const x of ['2027-02-29', '0000-01-01', '2027-13-01', '2027-00-10', '2027-01-00', '2027-04-31', '2027-9-1',
      '2027-09-10T00:00', ' 2027-09-10', 20270910, null, undefined]) {
      expect(dateCivileStricte(x), String(x)).toBeNull()
    }
    expect(dateCivileStricte('2100-02-29')).toBeNull()
    expect(dateCivileStricte('2000-02-29')).toBe('2000-02-29')
  })

  it('un identifiant comme le lit la base : accolades, tirets après un groupe de quatre chiffres, majuscules', () => {
    const canonique = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
    for (const x of ['A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11', '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}',
      'a0eebc999c0b4ef8bb6d6bb9bd380a11', '{a0eebc999c0b4ef8bb6d6bb9bd380a11}', 'a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11']) {
      expect(uuidCommeLaBase(x), x).toBe(canonique)
    }
    for (const x of [' a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a1', '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}', 'a0eebc9-99c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99--9c0b-4ef8-bb6d-6bb9bd380a11',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11-', 'g0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '', 12, null]) {
      expect(uuidCommeLaBase(x), String(x)).toBeNull()
    }
  })
})

// ── Les refus dits avant le clic ────────────────────────────────────────────────────────────────────────────────────

describe('refusDeclaration — dit avant le clic ce que la base refuserait', () => {
  it('accepte une période finie, sous son régime, avec un contenu qui la porte', () => {
    expect(refus()).toBeNull()
    expect(refus({ objet: 'ventes', contenu: contenuVentes([{ date: '2027-09-15', factures: [FV] }]) })).toBeNull()
    expect(refus({ objet: 'paiements', contenu: contenuPaiements([{ date: '2027-09-20', encaissements: [E1] }]) })).toBeNull()
  })

  it('l’objet, puis les bornes — des dates que la base lit', () => {
    expect(cle({ objet: 'tout', debut: null })).toBe('objet')
    expect(cle({ objet: null })).toBe('objet')
    expect(cle({ debut: null, regimeId: null })).toBe('bornes_absentes')
    expect(cle({ fin: '2027-09-31' })).toBe('bornes_absentes')
    expect(cle({ debut: '01/09/2027' })).toBe('bornes_absentes')
  })

  it('le régime : du dossier, actif, qui couvre le premier jour', () => {
    expect(refus({ regimeId: null })).toEqual({ cle: 'regime_introuvable', code: 'P0002', message: 'Régime introuvable dans ce dossier.' })
    expect(cle({}, { regimes: [regime({ dossier_id: D2 })] })).toBe('regime_introuvable')
    expect(cle({ regimeId: R.toUpperCase() })).toBeNull()
    expect(cle({}, { regimes: [regime({ retire_le: '2027-10-01T10:00:00Z' })] })).toBe('regime_retire')
    expect(refus({}, { regimes: [regime({ depuis: '2027-09-02' })] })?.message)
      .toBe("Ce régime ne vaut qu'à partir du 02/09/2027 : il ne couvre pas le début de la période.")
    expect(refus({}, { regimes: [regime({ depuis: '2027-09-01' })] })).toBeNull()
  })

  it('le régime en vigueur au premier jour : le plus récent, même égal ; un retiré ne compte pas', () => {
    const suivant = (depuis: string, o: Partial<LigneDeRegime> = {}) => regime({ id: u(11), depuis, ...o })
    expect(refus({}, { regimes: [regime(), suivant('2027-09-01')] })?.message)
      .toBe('Le régime en vigueur le 01/09/2027 est celui confirmé à partir du 01/09/2027 : relisez.')
    expect(refus({}, { regimes: [regime(), suivant('2027-03-01'), regime({ id: u(12), depuis: '2027-06-01' })] })?.message)
      .toBe('Le régime en vigueur le 01/09/2027 est celui confirmé à partir du 01/06/2027 : relisez.')
    expect(cle({}, { regimes: [regime(), suivant('2027-06-01', { retire_le: '2027-07-01T10:00:00Z' })] })).toBeNull()
    expect(cle({}, { regimes: [regime(), suivant('2027-06-01', { dossier_id: D2 })] })).toBeNull()
  })

  it('un régime qui déclare autrement commence dans la période, le dernier jour compris ; un égal ou un retiré, non', () => {
    const autre = (depuis: string, o: Partial<LigneDeRegime> = {}) =>
      regime({ id: u(11), depuis, statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1', tva_periodicite: null, ...o })
    expect(refus({}, { regimes: [regime(), autre('2027-09-30')] })?.message)
      .toBe('Le régime du dossier change dans la période, le 30/09/2027 : une période à cheval sur deux régimes ne se déclare pas '
        + 'ici, les sources publiques ne disant pas comment. À trancher par le cabinet.')
    expect(cle({}, { regimes: [regime(), autre('2027-10-01')] })).toBeNull()
    expect(cle({}, { regimes: [regime(), regime({ id: u(11), depuis: '2027-09-15' })] })).toBeNull()
    expect(cle({}, { regimes: [regime(), autre('2027-09-15', { retire_le: '2027-09-20T10:00:00Z' })] })).toBeNull()
    // La fréquence des paiements seule suffit à en faire un autre régime.
    const exonere = regime({ statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1', tva_periodicite: null })
    expect(cle({}, { regimes: [exonere, autre('2027-09-15', { frequence_paiements: 'bimestre' })] })).toBe('regime_change')
    // Le premier changement se dit.
    expect(refus({}, { regimes: [regime(), autre('2027-09-20'), autre('2027-09-10', { id: u(12) })] })?.message).toContain('le 10/09/2027')
  })

  it('les paiements sur option pour les débits ; puis les bornes de la fréquence du régime', () => {
    const debits = regime({ tva_periodicite: 'mensuelle', tva_sur_debits: true, frequence_transactions: 'decade', frequence_paiements: null })
    expect(cle({ objet: 'paiements' }, { regimes: [debits] })).toBe('paiements_sur_debits')
    expect(refus({}, { regimes: [debits] })?.message)
      .toBe("Du 01/09/2027 au 30/09/2027 n'est pas une période de ses déclarations : sous ce régime, elles se font par décade.")
    expect(refus({ debut: '2027-09-01', fin: '2027-10-31' })?.message)
      .toBe("Du 01/09/2027 au 31/10/2027 n'est pas une période de ses déclarations : sous ce régime, elles se font chaque mois.")
    expect(cle({ debut: '2027-09-30', fin: '2027-09-01' })).toBe('periode_hors_regime')
    const franchise = regime({ statut_tva: 'franchise', tva_periodicite: null, frequence_transactions: 'bimestre', frequence_paiements: 'bimestre' })
    expect(refus({}, { regimes: [franchise] })?.message).toContain('elles se font tous les deux mois.')
  })

  it('la période finit le 1er septembre 2027 ou après [B]', () => {
    expect(refus({ debut: '2027-08-01', fin: '2027-08-31', contenu: contenuAchats([achat(F1, P1, '2027-08-10')], { debut: '2027-08-01', fin: '2027-08-31' }) })?.message)
      .toBe("La période finit le 31/08/2027, avant le 1er septembre 2027 : l'e-reporting d'une PME ou d'une micro-entreprise commence avec les factures de ce jour.")
  })

  it('une déclaration active d’autres bornes qui chevauche ; une remplacée, un autre objet, un autre dossier ne comptent pas', () => {
    const bimestre = declaration({ periode_debut: '2027-09-01', periode_fin: '2027-10-31' })
    expect(refus({}, { declarations: [bimestre] })?.message)
      .toBe("La période chevauche celle d'une déclaration active, du 01/09/2027 au 31/10/2027 : une même opération ne se déclare pas deux fois. À trancher par le cabinet.")
    expect(cle({}, { declarations: [{ ...bimestre, etat: 'remplacee' }] })).toBeNull()
    expect(cle({}, { declarations: [{ ...bimestre, objet: 'ventes' }] })).toBeNull()
    expect(cle({}, { declarations: [{ ...bimestre, dossier_id: D2 }] })).toBeNull()
    // La plus ancienne se dit.
    expect(refus({}, { declarations: [bimestre, declaration({ id: u(99), periode_debut: '2027-08-21', periode_fin: '2027-09-10' })] })?.message)
      .toContain('du 21/08/2027 au 10/09/2027')
    // Un seul jour partagé suffit, d'un côté comme de l'autre ; deux périodes qui se suivent ne se chevauchent pas.
    expect(cle({}, { declarations: [declaration({ periode_debut: '2027-09-30', periode_fin: '2027-10-31' })] })).toBe('chevauchement')
    expect(cle({}, { declarations: [declaration({ periode_debut: '2027-08-01', periode_fin: '2027-09-01' })] })).toBe('chevauchement')
    expect(cle({}, { declarations: [declaration({ periode_debut: '2027-10-01', periode_fin: '2027-10-31' })] })).toBeNull()
    expect(cle({}, { declarations: [declaration({ periode_debut: '2027-08-01', periode_fin: '2027-08-31' })] })).toBeNull()
  })

  it('l’initiale sur une période déclarée ; la rectificative : introuvable, d’une autre période, déjà remplacée [DG]', () => {
    const active = declaration()
    expect(refus({}, { declarations: [active] })?.message)
      .toBe('Une déclaration de cette période est déjà active, faite sur « Plateforme A » : une correction se fait par une déclaration rectificative, qui la remplace entière.')
    expect(refus({ remplaceId: active.id }, { declarations: [active] })).toBeNull()
    // La base lit l'identifiant sous toutes ses formes : des accolades, des majuscules (u(100) n'a aucune lettre).
    expect(refus({ remplaceId: `{${active.id}}` }, { declarations: [active] })).toBeNull()
    const lettres = declaration({ id: u(0xabcdef) })
    expect(refus({ remplaceId: lettres.id.toUpperCase() }, { declarations: [lettres] })).toBeNull()
    expect(refus({ remplaceId: u(98) }, { declarations: [active] })?.code).toBe('P0002')
    expect(cle({ remplaceId: active.id }, { declarations: [{ ...active, dossier_id: D2 }] })).toBe('remplacee_introuvable')
    expect(cle({ remplaceId: active.id }, { declarations: [{ ...active, objet: 'ventes' }] })).toBe('remplacee_autre_periode')
    expect(cle({ remplaceId: active.id }, { declarations: [{ ...active, periode_fin: '2027-10-31' }] })).toBe('chevauchement')
    expect(cle({ remplaceId: active.id }, { declarations: [{ ...active, etat: 'remplacee' }] })).toBe('remplacee_deja')
  })

  it('la plateforme et la note, comptées en caractères ; des espaces ne sont ni une plateforme ni une note', () => {
    expect(cle({ plateforme: null })).toBe('plateforme_absente')
    expect(cle({ plateforme: '   ' })).toBe('plateforme_absente')
    expect(cle({ plateforme: '😀'.repeat(200) })).toBeNull()
    expect(cle({ plateforme: '😀'.repeat(201) })).toBe('plateforme_trop_longue')
    expect(cle({ plateforme: 'p'.repeat(201), note: 'n'.repeat(2001) })).toBe('plateforme_trop_longue')
    expect(cle({ note: 'n'.repeat(2000) })).toBeNull()
    expect(cle({ note: 'n'.repeat(2001) })).toBe('note_trop_longue')
    expect(cle({ note: '😀'.repeat(2000) })).toBeNull()
    expect(cle({ note: ' '.repeat(3000) })).toBeNull()
    // La base n'ôte que des espaces (`btrim`) : une tabulation est un texte, qui se compte.
    expect(cle({ plateforme: '\t' })).toBeNull()
    expect(cle({ note: '\t'.repeat(2001) })).toBe('note_trop_longue')
  })

  // Trois contenus d'un mégaoctet : les juger coûte, sur une machine chargée, plus que le délai d'un test (5 s, dépassé
  // le 23/10/2026 sous New York). Le calcul se paie une fois, ici, jamais en relevant le délai.
  let contenusLourds: (string | null)[] = []
  beforeAll(() => {
    contenusLourds = [
      cle({ contenu: { bourre: 'b'.repeat(1_048_563) } }),
      cle({ contenu: { bourre: 'b'.repeat(1_048_562) } }),
      cle({ contenu: { bourre: 'é'.repeat(600_000) } }),
    ]
  })

  it('le contenu : un objet, d’un mégaoctet au plus, sur l’objet, les bornes et le rôle annoncés', () => {
    for (const contenu of [null, undefined, [], 'contenu', 12]) expect(cle({ contenu }), String(contenu)).toBe('contenu_absent')
    // Un octet de trop, juste à la borne, et un mégaoctet de lettres de deux octets.
    expect(contenusLourds).toEqual(['contenu_trop_grand', 'contenu_autre', 'contenu_trop_grand'])
    expect(cle({ contenu: contenuAchats([achat(F1, P1)], { objet: 'ventes' }) })).toBe('contenu_autre')
    expect(cle({ contenu: contenuAchats([achat(F1, P1)], { debut: '2027-09-02' }) })).toBe('contenu_autre')
    expect(cle({ contenu: contenuAchats([achat(F1, P1)], { fin: 20270930 }) })).toBe('contenu_autre')
    expect(cle({ contenu: contenuAchats([achat(F1, P1)], { role: 'SE' }) })).toBe('contenu_autre')
    expect(cle({ objet: 'paiements', contenu: contenuPaiements([{ date: '2027-09-20', encaissements: [E1] }], { role: undefined }) })).toBe('contenu_autre')
  })

  it('les opérations, lisibles : chacune un objet, sa date civile, ses sources écrites comme des identifiants', () => {
    const illisible = (contenu: unknown, objet = 'achats') => expect(cle({ objet, contenu }), JSON.stringify(contenu)).toBe('contenu_illisible')
    illisible(contenuAchats([]).achats === undefined ? {} : { ...contenuAchats([]), achats: undefined })
    illisible({ ...contenuAchats([]), achats: { ficheId: F1 } })
    illisible(contenuAchats([F1]))
    illisible(contenuAchats([null]))
    // Un tableau qui porterait les champs d'un achat n'est pas un objet : JSON ne les écrirait même pas.
    illisible(contenuAchats([Object.assign([], achat(F1, P1))]))
    illisible(contenuAchats([{ ficheId: F1, pieceId: P1 }]))
    illisible(contenuAchats([achat(F1, P1, '2027-09-31')]))
    illisible(contenuAchats([achat(F1, P1, '2027-09-10T00:00')]))
    illisible(contenuAchats([{ pieceId: P1, date: '2027-09-10' }]))
    illisible(contenuAchats([{ ficheId: 'F1', pieceId: P1, date: '2027-09-10' }]))
    // Un nombre de trente-deux chiffres se lirait comme un identifiant : la base le refuse à sa forme, avant de le chercher.
    illisible(contenuAchats([{ ficheId: F1, pieceId: Number('12345678123456781234567812345678'), date: '2027-09-10' }]))
    illisible(contenuVentes([{ date: '2027-09-15', factures: FV as unknown as unknown[] }]), 'ventes')
    illisible(contenuVentes([{ date: '2027-09-15', factures: [12] }]), 'ventes')
    illisible(contenuPaiements([{ date: '2027-09-20', encaissements: [` ${E1}`] }]), 'paiements')
    expect(cle({ contenu: contenuAchats([{ ficheId: `{${F1.toUpperCase()}}`, pieceId: P1, date: '2027-09-10' }]) })).toBeNull()
  })

  it('chaque opération dans la période, la plus ancienne dite ; jamais à blanc ; aucune source deux fois ; le nombre annoncé', () => {
    expect(refus({ contenu: contenuAchats([achat(F1, P1, '2027-10-01'), achat(F2, P2, '2027-08-31')]) })?.message)
      .toBe('Une opération du contenu est datée du 31/08/2027, hors de la période : relisez.')
    expect(refus({ contenu: contenuAchats([]) })?.message)
      .toBe("Une période sans opération ne se déclare pas : aucune transmission n'est attendue.")
    expect(cle({ objet: 'ventes', contenu: contenuVentes([{ date: '2027-09-15', factures: [] }]) })).toBe('a_blanc')
    expect(cle({ contenu: contenuAchats([achat(F1, P1), achat(F1.toUpperCase(), P1)]) })).toBe('source_en_double')
    expect(cle({ objet: 'ventes', contenu: contenuVentes([{ date: '2027-09-15', factures: [FV] }, { date: '2027-09-16', factures: [`{${FV}}`] }]) }))
      .toBe('source_en_double')
    expect(refus({ contenu: contenuAchats([achat(F1, P1)], { nombreOperations: 2 }) })?.message)
      .toBe("Le contenu n'annonce pas le nombre de ses opérations (1) : relisez.")
    expect(cle({ contenu: contenuAchats([achat(F1, P1)], { nombreOperations: '1' }) })).toBe('nombre_operations')
    expect(cle({ contenu: contenuAchats([achat(F1, P1)], { nombreOperations: undefined }) })).toBe('nombre_operations')
    // Les factures se comptent, pas les agrégats.
    expect(cle({ objet: 'ventes', contenu: contenuVentes([{ date: '2027-09-15', factures: [FV, FB] }], { nombreOperations: 1 }) }))
      .toBe('nombre_operations')
  })

  it('des sources de ce dossier : la fiche de la pièce nommée, une facture validée, un encaissement', () => {
    expect(refus({ contenu: contenuAchats([achat(FX, PX)]) })?.message)
      .toBe("Une source du contenu n'est pas la fiche « fournisseur établi hors de France » d'une pièce de ce dossier : relisez.")
    expect(cle({ contenu: contenuAchats([achat(F1, P2)]) })).toBe('source_inconnue')
    expect(cle({ contenu: contenuAchats([achat(u(97), P1)]) })).toBe('source_inconnue')
    // La fiche ET sa pièce, de ce dossier.
    expect(cle({}, { fiches: [{ id: F1, dossier_id: D2, piece_id: P1 }] })).toBe('source_inconnue')
    expect(cle({}, { pieces: [{ id: P1, dossier_id: D2 }] })).toBe('source_inconnue')
    expect(cle({}, { pieces: [] })).toBe('source_inconnue')
    expect(refus({ objet: 'ventes', contenu: contenuVentes([{ date: '2027-09-15', factures: [FV, FB] }]) })?.message)
      .toBe("Une source du contenu n'est pas une facture validée de ce dossier : relisez.")
    expect(cle({ objet: 'ventes', contenu: contenuVentes([{ date: '2027-09-15', factures: [FX2] }]) })).toBe('source_inconnue')
    expect(refus({ objet: 'paiements', contenu: contenuPaiements([{ date: '2027-09-20', encaissements: [EX] }]) })?.message)
      .toBe("Une source du contenu n'est pas un encaissement de ce dossier : relisez.")
    // Une version remplacée de la fiche reste la fiche de sa pièce : la base garde ce qui a été déclaré.
    const versions = contexte().fiches.concat({ id: F1B, dossier_id: D, piece_id: P1 })
    expect(cle({ contenu: contenuAchats([achat(F1, P1)]) }, { fiches: versions })).toBeNull()
  })

  it('une opération qu’une autre déclaration active porte : la même pièce sous une autre version, une facture, un encaissement', () => {
    const octobre = declaration({ id: u(101), periode_debut: '2027-10-01', periode_fin: '2027-10-31', plateforme: 'P' })
    const versions = contexte().fiches.concat({ id: F1B, dossier_id: D, piece_id: P1 })
    expect(refus({ contenu: contenuAchats([achat(F1, P1)]) }, { fiches: versions, declarations: [octobre], sources: [{ declaration_id: octobre.id, genre: 'fiche', source_id: F1B }] })?.message)
      .toBe("Une opération du contenu est déjà déclarée, dans la période du 01/10/2027 au 31/10/2027 : la période qui la porte se rectifie d'abord.")
    // Une remplacée ne compte pas, ni la déclaration que la rectificative remplace.
    expect(cle({}, { declarations: [{ ...octobre, etat: 'remplacee' }], sources: [{ declaration_id: octobre.id, genre: 'fiche', source_id: F1 }] })).toBeNull()
    const septembre = declaration()
    expect(cle({ remplaceId: septembre.id }, { declarations: [septembre], sources: [{ declaration_id: septembre.id, genre: 'fiche', source_id: F1 }] })).toBeNull()
    expect(cle({ remplaceId: `{${septembre.id}}` }, { declarations: [septembre], sources: [{ declaration_id: septembre.id, genre: 'fiche', source_id: F1 }] })).toBeNull()
    expect(cle({ objet: 'ventes', contenu: contenuVentes([{ date: '2027-09-15', factures: [FV] }]) },
      { declarations: [{ ...octobre, objet: 'ventes' }], sources: [{ declaration_id: octobre.id, genre: 'facture', source_id: FV }] })).toBe('source_deja_declaree')
    expect(cle({ objet: 'paiements', contenu: contenuPaiements([{ date: '2027-09-20', encaissements: [E1] }]) },
      { declarations: [{ ...octobre, objet: 'paiements' }], sources: [{ declaration_id: octobre.id, genre: 'encaissement', source_id: E1 }] })).toBe('source_deja_declaree')
  })

  it('la période finie, à Paris : le lendemain de sa fin', () => {
    expect(refus({}, { aujourdHui: '2027-09-30' })?.message).toBe("La période n'est pas finie : elle se déclare à partir du 01/10/2027.")
    expect(refus({}, { aujourdHui: '2027-10-01' })).toBeNull()
  })
})

describe('argumentsDeLaDeclaration et contenuADeclarer', () => {
  it('les paramètres de la fonction : le dossier annoncé, des dates civiles seules, un contenu jamais indéfini', () => {
    expect(argumentsDeLaDeclaration(D, saisie({ debut: '2027-09-31', fin: '2027-09-30', contenu: undefined }))).toEqual({
      p_dossier_id: D, p_objet: 'achats', p_debut: null, p_fin: '2027-09-30', p_regime_id: R, p_remplace_id: null,
      p_plateforme: 'Plateforme A', p_contenu: null, p_note: null,
    })
  })

  it('le contenu d’e4 précédé de sa version, de son objet et de ses bornes ; rien sans période ni contenu', () => {
    const d = calculAchats([achatDeclare()])
    expect(contenuADeclarer(d)).toEqual({ version: VERSION_DU_CONTENU, objet: 'achats', debut: '2027-10-01', fin: '2027-10-31', ...d.contenu })
    expect(contenuADeclarer({ ...d, contenu: null })).toBeNull()
    expect(contenuADeclarer({ ...d, periode: null })).toBeNull()
    // Une clé d'e4 qui porterait le nom d'une borne n'est pas effacée en silence : elle reste, et le refus 22 la dit.
    const contenuE4 = d.contenu
    if (contenuE4 == null) throw new Error('e4 n’a rien calculé')
    const avecUneBorne = { ...d, contenu: { ...contenuE4, debut: '2027-10-02' } }
    const declare = contenuADeclarer(avecUneBorne)
    expect(declare?.debut).toBe('2027-10-02')
    expect(refusDeclaration(saisie({ debut: '2027-10-01', fin: '2027-10-31', contenu: declare }), contexte())?.cle).toBe('contenu_autre')
  })
})

// ── Ce qu'e4 calcule, la base l'accepte ─────────────────────────────────────────────────────────────────────────────

describe('le contenu qu’e4 calcule passe les refus de la fonction, et traverse une sauvegarde', () => {
  const SIRET = '12345678200010'
  const dossierE4: DossierEreporting = {
    id: D, siret: SIRET, statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false,
    tva_periodicite: 'trimestrielle', tva_sur_debits: false,
  }
  const regimeE4: RegimeEreporting = { ...regime(), note: null, cree_par: 'u1', cree_le: '2026-01-02T10:00:00Z', retire_par: null }
  const contexteE4 = { periode: { debut: '2027-10-01', fin: '2027-10-31' }, dossier: dossierE4, regimes: lu([regimeE4]), aujourdHui: '2027-11-05' }
  const pieceE4: PieceLue = { id: P1, dossier_id: D, type_piece: 'achat', devise: 'EUR', montant_ttc: 120, montant_devise: null, montant_tva: null, tiers: 'Editeur', date_piece: '2027-10-05' }
  const ficheE4: PieceHorsDeFrance = {
    id: F1, dossier_id: D, piece_id: P1, remplace_id: null, numero: 'INV-1', date_facture: '2027-10-05', type_document: '380',
    facture_origine_numero: null, facture_origine_date: null, devise: 'EUR', pays: 'IE', schema_identifiant: '0223',
    identifiant: 'IE7777777T', nature: 'services', autoliquidation: true, date_operation: null, periode_debut: null,
    periode_fin: null, cree_par: 'u1', cree_le: '2027-10-06T10:00:00Z', retire_le: null, retire_par: null,
  }
  const tauxE4: PieceHorsDeFranceTaux = { fiche_id: F1, dossier_id: D, code_tva: 'AE', taux: 0, base: 120, tva: 0, motif_code: null, motif_texte: null }
  const factureE4: FactureLue = {
    id: FV, dossier_id: D, statut: 'validee', type: 'facture', date_emission: '2027-10-08', montant_ht: 100, montant_tva: 20,
    montant_ttc: 120, type_client: 'non_assujetti', nature_operation: 'services', option_debits: false, date_prestation: null, periode_fin: null,
  }
  const ligneE4: LigneLue = { facture_id: FV, ordre: 0, designation: 'Séance', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }
  const encaissementE4: EncaissementLu = { id: E1, dossier_id: D, facture_id: FV, date_encaissement: '2027-10-15', montant: 120, annule_id: null, retire_le: null }
  const partE4: PartLue = { encaissement_id: E1, dossier_id: D, taux: 20, montant: 120 }
  const contexteDeLaBase = contexte({
    regimes: [regimeE4], fiches: [ficheE4], pieces: [pieceE4], factures: [factureE4], encaissements: [encaissementE4], aujourdHui: '2027-11-05',
  })
  const octobre = (objet: string, contenu: unknown): SaisieDeclaration =>
    ({ objet, debut: '2027-10-01', fin: '2027-10-31', regimeId: R, remplaceId: null, plateforme: 'Plateforme A', contenu, note: null })

  it('les achats, les ventes et les paiements d’octobre 2027', async () => {
    const calculs = [
      declarationDesAchats(contexteE4, { pieces: lu([pieceE4]), fiches: lu([ficheE4]), taux: lu([tauxE4]), textes: lu<TexteDePiece>([]), ecarts: lu<EcartLu>([]) },
        { rangement: 'date_de_realisation' }),
      declarationDesVentes(contexteE4, { factures: lu([factureE4]), lignes: lu([ligneE4]) }, { rangement: 'date_de_realisation' }),
      declarationDesPaiements(contexteE4, { factures: lu([factureE4]), encaissements: lu([encaissementE4]), parts: lu([partE4]) },
        { contrePassation: 'date_du_decaissement' }),
    ]
    for (const d of calculs) {
      expect(d.etat, d.objet).toBe('a_declarer')
      const contenu = contenuADeclarer(d)
      expect(refusDeclaration(octobre(d.objet, contenu), contexteDeLaBase), d.objet).toBeNull()
      // Ce que la sauvegarde relit en JSON a la même forme, donc la même empreinte.
      const relu: unknown = JSON.parse(JSON.stringify(contenu))
      expect(formeCanonique(relu)).toBe(formeCanonique(contenu))
      expect(await empreinteDuContenu(relu)).toBe(await empreinteDuContenu(contenu))
    }
  })
})

// ── L'essai, rejoué appel par appel ─────────────────────────────────────────────────────────────────────────────────

/** Les identifiants de l'essai : les fixes de son bloc `ids`, et des identifiants fictifs pour ceux que la base tire. */
function nomsDeLEssai(essai: string): Map<string, string> {
  const noms = new Map<string, string>()
  for (const m of essai.matchAll(/'([A-Z][A-Z0-9_]*)', '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/g)) noms.set(m[1], m[2])
  let n = 0
  for (const nom of ['CAB', 'DC', 'AUTRE', 'CHEF']) noms.set(nom, `e5b0fa1e-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`)
  return noms
}

/** Les expressions de l'essai qui écrivent un argument : littéraux, `repeat`, et ce qu'il faut de `jsonb_*` pour bâtir un
 * contenu — rien d'autre ; une forme inconnue lève. */
function valeurDe(expression: string): unknown {
  const e = expression.trim()
  let m: RegExpExecArray | null
  if (e === 'null') return null
  if (e === 'true' || e === 'false') return e === 'true'
  if (/^-?\d+(?:\.\d+)?$/.test(e)) return Number(e)
  if ((m = /^repeat\('((?:[^']|'')*)', (\d+)\)$/.exec(e))) return m[1].replace(/''/g, "'").repeat(Number(m[2]))
  if ((m = /^'([\s\S]*)'::jsonb$/.exec(e))) return JSON.parse(m[1].replace(/''/g, "'")) as unknown
  if ((m = /^jsonb_build_object\(([\s\S]*)\)$/.exec(e))) {
    const a = decouper(m[1])
    return Object.fromEntries(a.flatMap((x, i) => (i % 2 === 0 ? [[String(valeurDe(x)), valeurDe(a[i + 1])]] : [])))
  }
  if ((m = /^jsonb_build_array\(([\s\S]*)\)$/.exec(e))) return decouper(m[1]).map(valeurDe)
  if ((m = /^(?:to_jsonb|upper)\(([\s\S]*)\)$/.exec(e)) && decouper(m[1]).length === 1) {
    const v = valeurDe(m[1])
    return e.startsWith('upper') ? String(v).toUpperCase() : v
  }
  if ((m = /^jsonb_set\(([\s\S]*)\)$/.exec(e))) {
    const [cible, chemin, v] = decouper(m[1])
    const racine = valeurDe(cible) as Record<string, unknown>
    const cles = String(valeurDe(chemin)).replace(/^\{|\}$/g, '').split(',')
    let noeud = racine as Record<string, unknown> | unknown[]
    for (const c of cles.slice(0, -1)) noeud = (noeud as Record<string, unknown>)[c] as Record<string, unknown>
    ;(noeud as Record<string, unknown>)[cles[cles.length - 1]] = valeurDe(v)
    return racine
  }
  const morceaux = concatenation(e)
  if (morceaux.length > 1) return morceaux.map((x) => String(valeurDe(x))).join('')
  if ((m = /^'([\s\S]*)'$/.exec(e))) return m[1].replace(/''/g, "'")
  throw new Error(`Expression que le test ne sait pas lire : ${e.slice(0, 200)}`)
}

/** Une expression coupée sur ses `||` de premier niveau, hors chaînes. */
function concatenation(texte: string): string[] {
  const morceaux: string[] = []
  let profondeur = 0
  let chaine = false
  let courant = ''
  for (let i = 0; i < texte.length; i++) {
    const car = texte[i]
    if (car === "'") chaine = !chaine
    if (!chaine && car === '(') profondeur++
    if (!chaine && car === ')') profondeur--
    if (!chaine && profondeur === 0 && texte.startsWith(' || ', i)) {
      morceaux.push(courant)
      courant = ''
      i += 3
      continue
    }
    courant += car
  }
  morceaux.push(courant)
  return morceaux
}

interface Rejeu {
  etape: Etape
  /** Ce que la base a fait de l'appel : « OK », ou le code et le message (motif LIKE) que l'essai a exigés. */
  base: string
  /** Ce que le module en dit : `acces` (que l'écran ne peut pas dire, et l'essai juge à son code), `OK`, ou son refus. */
  cle: string
  message: string | null
}

const texteDe = (v: unknown) => (v == null ? null : String(v))

/**
 * L'essai rejoué : ce qu'il a construit en base au moment de chaque étape — dossiers, pièces, fiches, factures,
 * encaissements, régimes, déclarations et sources, que ses étapes `jeu` et `fait` écrivent (un `controle` s'annule) —
 * et, pour chaque appel à la fonction, ce que le module en dit. Les accès sont ceux du moteur : le chef
 * (super-administrateur) et le chef simple partout dans le cabinet, le membre dans T seul, le membre d'ailleurs dans A seul,
 * le client, le compte rattaché à rien et l'anonyme nulle part ; un dossier qui n'existe pas, pour personne.
 */
function rejouer(essai: string, aujourdHui = AUJOURD_HUI): Rejeu[] {
  const noms = nomsDeLEssai(essai)
  let compteur = 100
  const nouveau = () => `e5b0fa1e-0000-4000-8001-${(++compteur).toString(16).padStart(12, '0')}`
  const dossiers = new Set<string>([noms.get('DC') as string])
  const pieces: { id: string; dossier_id: string }[] = []
  const fiches: { id: string; dossier_id: string; piece_id: string; remplace_id: string | null }[] = []
  const factures: { id: string; dossier_id: string; statut: FactureEmise['statut']; date_emission: string }[] = []
  const encaissements: { id: string; dossier_id: string; facture_id: string; date_encaissement: string }[] = []
  const regimes: LigneDeRegime[] = []
  const declarations: (Ligne & { type_transmission: string; remplace_id: string | null })[] = []
  const sources: { declaration_id: string; dossier_id: string; genre: 'fiche' | 'facture' | 'encaissement'; source_id: string }[] = []
  const rejeux: Rejeu[] = []
  // Le mois du jour et celui qui le précède, lus à Paris (les étapes « retenir » MD, MF, PD, PF).
  const md = `${aujourdHui.slice(0, 7)}-01`
  const mois: Record<string, string> = { MD: md, MF: dernierJourDuMois(md), PD: ajouterMois(md, -1), PF: ajouterJours(md, -1) }
  const seule = (trouvees: { id: string }[], quoi: string) => {
    expect(trouvees, quoi).toHaveLength(1)
    return trouvees[0]?.id ?? ''
  }
  const acces = (profil: string, dossier: string) => dossiers.has(dossier) && (['chef', 'chef_simple'].includes(profil)
    || (profil === 'membre' && dossier === noms.get('T')) || (profil === 'membre_ailleurs' && dossier === noms.get('A')))

  for (const e of etapesDe(essai)) {
    const appel = remplacerLesNoms(e.appel, noms)
    if (e.genre === 'retenir') {
      let m: RegExpExecArray | null
      if (e.titre in mois) noms.set(e.titre, mois[e.titre])
      else if ((m = /^select id::text from pieces_hors_de_france where (piece_id|remplace_id) = '([\w-]+)'$/.exec(appel))) {
        const [, colonne, valeur] = m
        noms.set(e.titre, seule(fiches.filter((f) => (colonne === 'piece_id' ? f.piece_id : f.remplace_id) === valeur), appel))
      } else if ((m = /^select id::text from factures_emises where dossier_id = '([\w-]+)' and (statut|date_emission) = '([\w-]+)'$/.exec(appel))) {
        const [, d, colonne, valeur] = m
        noms.set(e.titre, seule(factures.filter((f) => f.dossier_id === d && (colonne === 'statut' ? f.statut : f.date_emission) === valeur), appel))
      } else if ((m = /^select id::text from encaissements_factures where facture_id = '([\w-]+)'(?: and date_encaissement = '([\d-]+)')?$/.exec(appel))) {
        const [, f, date] = m
        noms.set(e.titre, seule(encaissements.filter((x) => x.facture_id === f && (date == null || x.date_encaissement === date)), appel))
      } else if ((m = /^select id::text from regimes_ereporting where dossier_id = '([\w-]+)' and depuis = '([\d-]+)'( and retire_le is null)?$/.exec(appel))) {
        const [, d, depuis, actif] = m
        noms.set(e.titre, seule(regimes.filter((r) => r.dossier_id === d && r.depuis === depuis && (actif == null || r.retire_le == null)), appel))
      } else if ((m = /^select id::text from declarations_ereporting where dossier_id = '([\w-]+)' and objet = '(\w+)' and periode_debut = '([\d-]+)' and type_transmission = '(\w+)'$/.exec(appel))) {
        const [, d, objet, debut, type] = m
        noms.set(e.titre, seule(declarations.filter((x) => x.dossier_id === d && x.objet === objet && x.periode_debut === debut && x.type_transmission === type), appel))
      } else if ((m = /^select id::text from declarations_ereporting where remplace_id = '([\w-]+)'$/.exec(appel))) {
        const remplace = m[1]
        noms.set(e.titre, seule(declarations.filter((x) => x.remplace_id === remplace), appel))
      } else throw new Error(`Étape « retenir » que le test ne sait pas lire : ${e.appel}`)
      continue
    }
    if (e.genre === 'jeu' || (e.genre === 'fait' && appel.startsWith('insert into'))) {
      for (const d of lignesInserees(e.appel, 'dossiers', noms)) dossiers.add(String(d.id))
      for (const p of lignesInserees(e.appel, 'pieces', noms)) pieces.push({ id: String(p.id), dossier_id: String(p.dossier_id) })
      for (const r of lignesInserees(e.appel, 'regimes_ereporting', noms)) regimes.push(r as unknown as LigneDeRegime)
      for (const d of lignesInserees(e.appel, 'declarations_ereporting', noms)) declarations.push(d as unknown as (typeof declarations)[number])
      for (const s of lignesInserees(e.appel, 'declarations_ereporting_sources', noms)) sources.push(s as unknown as (typeof sources)[number])
      continue
    }
    if (e.genre !== 'fait' && e.genre !== 'controle') continue
    const appels = appelsDe(appel)
    // Une écriture directe juge la garde et les contraintes, pas le module.
    if (appels == null) continue
    const fait = e.genre === 'fait'
    if (fait) expect(e.code, e.titre).toBe('OK')
    const base = e.code === 'OK' ? 'OK' : `${e.code} ${e.attendu}`
    for (const { fonction, arguments: brut } of appels) {
      const v = brut.map(valeurDe)
      const dossier = String(v[0])
      if (fonction === 'enregistrer_fiche_hors_de_france') {
        if (fait) fiches.push({ id: nouveau(), dossier_id: dossier, piece_id: String(v[1]), remplace_id: texteDe(v[2]) })
      } else if (fonction === 'enregistrer_facture') {
        const entete = v[2] as { date_emission: string }
        if (fait) factures.push({ id: nouveau(), dossier_id: dossier, statut: v[4] === true ? 'validee' : 'brouillon', date_emission: entete.date_emission })
      } else if (fonction === 'enregistrer_encaissement') {
        if (fait) encaissements.push({ id: nouveau(), dossier_id: dossier, facture_id: String(v[1]), date_encaissement: String(v[2]) })
      } else if (fonction === 'confirmer_regime_ereporting') {
        if (fait) {
          regimes.push({
            id: nouveau(), dossier_id: dossier, depuis: String(v[1]), statut_tva: v[2] as LigneDeRegime['statut_tva'],
            article_exoneration: v[3] as LigneDeRegime['article_exoneration'], tva_periodicite: v[4] as LigneDeRegime['tva_periodicite'],
            tva_sur_debits: v[5] === true, frequence_transactions: v[6] as LigneDeRegime['frequence_transactions'],
            frequence_paiements: v[7] as LigneDeRegime['frequence_paiements'], retire_le: null,
          })
        }
      } else if (fonction === 'retirer_regime_ereporting') {
        const r = regimes.find((x) => x.id === v[1])
        expect(r, e.titre).toBeDefined()
        if (fait && r) r.retire_le = `${aujourdHui}T08:00:00Z`
      } else if (fonction === 'declarer_ereporting_hors_application') {
        expect(v, e.titre).toHaveLength(9)
        const s: SaisieDeclaration = {
          objet: texteDe(v[1]), debut: texteDe(v[2]), fin: texteDe(v[3]), regimeId: texteDe(v[4]), remplaceId: texteDe(v[5]),
          plateforme: texteDe(v[6]), contenu: v[7], note: texteDe(v[8]),
        }
        if (!acces(e.profil, dossier)) {
          rejeux.push({ etape: e, base, cle: 'acces', message: null })
          continue
        }
        const r = refusDeclaration(s, { dossierId: dossier, regimes, declarations, sources, fiches, pieces, factures, encaissements, aujourdHui })
        rejeux.push({ etape: e, base, cle: r?.cle ?? 'OK', message: r?.message ?? null })
        if (fait && r == null) {
          const objet = s.objet as Ligne['objet']
          const remplace = s.remplaceId == null ? null : uuidCommeLaBase(s.remplaceId)
          const id = nouveau()
          if (remplace) {
            const ancienne = declarations.find((x) => x.id === remplace)
            if (ancienne) ancienne.etat = 'remplacee'
          }
          declarations.push({
            id, dossier_id: dossier, objet, periode_debut: String(s.debut), periode_fin: String(s.fin), etat: 'declaree',
            plateforme: String(s.plateforme), type_transmission: remplace ? 'RE' : 'IN', remplace_id: remplace,
          })
          const contenu = s.contenu as Record<string, unknown[]>
          const ops = contenu[objet === 'achats' ? 'achats' : objet === 'ventes' ? 'transactions' : 'paiements'] as Record<string, unknown>[]
          const genre = objet === 'achats' ? 'fiche' : objet === 'ventes' ? 'facture' : 'encaissement'
          const ids = objet === 'achats' ? ops.map((o) => o.ficheId) : ops.flatMap((o) => o[objet === 'ventes' ? 'factures' : 'encaissements'] as unknown[])
          for (const x of ids) sources.push({ declaration_id: id, dossier_id: dossier, genre, source_id: uuidCommeLaBase(x) as string })
        }
      } else throw new Error(`Fonction que le test ne sait pas rejouer : ${fonction}`)
    }
  }
  return rejeux
}

// Le module dit-il ce que la base a dit ? L'accès se juge à son code, un refus à son code et à ses mots.
function concorde(r: Rejeu): boolean {
  if (r.cle === 'acces') return r.base.startsWith('42501 ')
  if (r.cle === 'OK') return r.base === 'OK'
  const code = REFUS_DECLARATION.find((x) => x.cle === r.cle)?.code ?? '?'
  return r.base.startsWith(`${code} `) && commeLaBase(r.base.slice(code.length + 1), r.message)
}

describe('l’essai joué sur la réplique, rejoué appel par appel', () => {
  const rejeux = rejouer(ESSAI)

  it('le module dit ce que la base a dit, à chaque appel', () => {
    for (const r of rejeux) expect(concorde(r), `${r.etape.titre} : la base « ${r.base} », le module « ${r.cle} » ${r.message ?? ''}`).toBe(true)
  })

  it('rejoue tous les appels à la fonction, parties A et B', () => {
    // Compté dans le texte de l'essai, sans le lire comme le rejeu : chaque appel des étapes jouées.
    const ecrits = etapesDe(ESSAI).filter((e) => e.genre === 'fait' || e.genre === 'controle')
      .reduce((n, e) => n + (e.appel.match(/\bdeclarer_ereporting_hors_application\(/g)?.length ?? 0), 0)
    expect(rejeux).toHaveLength(ecrits)
    expect(rejeux.length).toBeGreaterThanOrEqual(110)
    const compte = (cle: string) => rejeux.filter((r) => r.cle === cle).length
    // 119 appels : 11 acceptés (les cinq `fait` de la partie B et six contrôles), 7 accès refusés, 101 refus dits avant le clic.
    expect([rejeux.length, compte('OK'), compte('acces')]).toEqual([119, 11, 7])
  })

  it('chaque refus de la fonction a été rendu au moins une fois par la base', () => {
    const vus = new Set(rejeux.map((r) => r.cle))
    expect(REFUS_DECLARATION.map((x) => x.cle).filter((c) => !vus.has(c))).toEqual([])
  })

  // Chaque défaut planté rejoue l'essai entier, ses contenus d'un mégaoctet compris : les trois rejeux se paient une fois,
  // dans un crochet au délai déclaré, jamais dans le corps d'un test, où la charge leur faisait passer les 5 s de Vitest.
  // Nul tant que le crochet n'a rien rendu : un rejeu qui n'aurait pas tourné ne passe pas pour « rien vu ».
  const DEFAUTS_PLANTES: { avant: string, apres: string }[] = [
    // Un message réécrit dans l'essai.
    {
      avant: "faite sur « Plateforme B » : une correction se fait par une déclaration rectificative, qui la remplace entière.'],\n    array['controle', '18b.",
      apres: "faite sur « Plateforme C » : une correction se fait par une déclaration rectificative, qui la remplace entière.'],\n    array['controle', '18b.",
    },
    // Un accepté devenu refus.
    { avant: "'{R1}', null, 'Plateforme', null, repeat('n', 2000))$q$,", apres: "'{R1}', null, 'Plateforme', null, repeat('n', 2001))$q$," },
    // Sans la source de DB, l'achat de mars 2099 ne retient plus la pièce de P2 : le module accepte, la base a refusé.
    { avant: "('{DB}', '{T}', 'fiche', '{F2}'), ", apres: '' },
  ]
  let plantes: { occurrences: number, discordants: string[] }[] | null = null
  beforeAll(() => {
    plantes = DEFAUTS_PLANTES.map(({ avant, apres }) => ({
      occurrences: ESSAI.split(avant).length - 1,
      discordants: rejouer(ESSAI.replace(avant, apres)).filter((r) => !concorde(r)).map((r) => r.etape.numero),
    }))
  }, 60_000)

  it('un message réécrit dans l’essai, un accepté devenu refus, une source oubliée : le rejeu les voit', () => {
    expect(plantes?.map((p) => p.occurrences)).toEqual([1, 1, 1])
    expect(plantes?.map((p) => p.discordants)).toEqual([['18'], ['24b'], ['34']])
  })
})

// ── La pièce que sa déclaration retient, la déclaration active ──────────────────────────────────────────────────────

describe('declarationQuiRetientLaPiece et declarationActive', () => {
  const lectures = (o: Partial<Parameters<typeof declarationQuiRetientLaPiece>[1]> = {}) => ({
    fiches: [{ id: F1, dossier_id: D, piece_id: P1 }, { id: F1B, dossier_id: D, piece_id: P1 }, { id: F2, dossier_id: D, piece_id: P2 }],
    declarations: [declaration()],
    sources: [{ declaration_id: u(100), dossier_id: D, genre: 'fiche' as const, source_id: F1 }],
    ...o,
  })

  it('une active qui cite une fiche de la pièce — n’importe quelle version — la retient, et la base le dit ainsi', () => {
    expect(declarationQuiRetientLaPiece(P1, lectures())).toEqual({
      declaration: declaration(),
      message: "Cette pièce est déclarée à l'e-reporting des achats du 01/09/2027 au 30/09/2027 : elle ne se supprime plus, sauf "
        + 'avec son dossier — une erreur se corrige par une déclaration rectificative de la période.',
    })
    expect(declarationQuiRetientLaPiece(P1, lectures({ sources: [{ declaration_id: u(100), dossier_id: D, genre: 'fiche', source_id: F1B }] }))).not.toBeNull()
    expect(declarationQuiRetientLaPiece(P2, lectures())).toBeNull()
  })

  it('une remplacée ne retient rien ; une source d’un autre dossier non plus ; la plus ancienne période se dit', () => {
    expect(declarationQuiRetientLaPiece(P1, lectures({ declarations: [declaration({ etat: 'remplacee' })] }))).toBeNull()
    expect(declarationQuiRetientLaPiece(P1, lectures({ sources: [{ declaration_id: u(100), dossier_id: D2, genre: 'fiche', source_id: F1 }] }))).toBeNull()
    expect(declarationQuiRetientLaPiece(P1, lectures({ sources: [{ declaration_id: u(100), dossier_id: D, genre: 'facture', source_id: F1 }] }))).toBeNull()
    const deux = lectures({
      declarations: [declaration({ id: u(102), periode_debut: '2027-10-01', periode_fin: '2027-10-31' }), declaration()],
      sources: [{ declaration_id: u(102), dossier_id: D, genre: 'fiche', source_id: F1B }, { declaration_id: u(100), dossier_id: D, genre: 'fiche', source_id: F1 }],
    })
    expect(declarationQuiRetientLaPiece(P1, deux)?.declaration.id).toBe(u(100))
  })

  it('l’active d’une période, d’un objet, d’un dossier', () => {
    const lignes = [declaration({ etat: 'remplacee', id: u(103) }), declaration(), declaration({ id: u(104), objet: 'ventes' })]
    expect(declarationActive(lignes, D, 'achats', { debut: '2027-09-01', fin: '2027-09-30' })?.id).toBe(u(100))
    expect(declarationActive(lignes, D, 'paiements', { debut: '2027-09-01', fin: '2027-09-30' })).toBeNull()
    expect(declarationActive(lignes, D2, 'achats', { debut: '2027-09-01', fin: '2027-09-30' })).toBeNull()
  })
})

// ── À rectifier ─────────────────────────────────────────────────────────────────────────────────────────────────────

const DECLAREE_LE = '2027-11-05T10:00:00Z'
const AVANT = '2027-10-06T10:00:00Z'
const APRES = '2027-11-06T10:00:00Z'

function achatDeclare(o: Partial<AchatDeclare> = {}): AchatDeclare {
  return {
    ficheId: F1, pieceId: P1, date: '2027-10-05', numero: 'INV-1', dateFacture: '2027-10-05', typeDocument: '380', origine: null,
    devise: 'EUR', pays: 'IE', schema: '0223', identifiant: 'IE7777777T', nature: 'services', cadre: 'S1', autoliquidation: true,
    dateOperation: null, periodeDebut: null, periodeFin: null,
    lignes: [{ code: 'AE', taux: 0, baseCentimes: 12000, tvaCentimes: 0, motifCode: null, motifTexte: null }],
    htCentimes: 12000, tvaEurosCentimes: 0, ...o,
  }
}

function calcul<C>(objet: 'achats' | 'ventes' | 'paiements', contenu: C | null, o: Partial<DeclarationEreporting<C>> = {}): DeclarationEreporting<C> {
  return {
    objet, obligation: 'due', frequence: { frequence: 'mois', certitude: 'confirmee', raison: null },
    periode: periodeDe('2027-10-01', 'mois'), regime: { etat: 'confirme', regime: regime() }, etat: 'a_declarer', refus: [],
    contenu, ecartees: [], ...o,
  }
}

function calculAchats(achats: AchatDeclare[], o: Partial<DeclarationEreporting<ContenuAchats>> = {}) {
  return calcul<ContenuAchats>('achats', {
    role: 'BY', siren: '123456782', numeroTva: 'FR11123456782', achats, nombreOperations: achats.length, totauxParDevise: [],
  }, o)
}

function transaction(o: Partial<TransactionsDuJour> = {}): TransactionsDuJour {
  return {
    date: '2027-10-08', devise: 'EUR', categorie: 'TPS1', optionDebits: false, htCentimes: 10000, tvaCentimes: 2000,
    parTaux: [{ taux: 20, baseCentimes: 10000, tvaCentimes: 2000 }], factures: [FV], ...o,
  }
}

function calculVentes(transactions: TransactionsDuJour[], o: Partial<ContenuVentes> = {}) {
  return calcul<ContenuVentes>('ventes', {
    role: 'SE', siren: '123456782', transactions, nombreOperations: transactions.reduce((n, t) => n + t.factures.length, 0),
    htCentimes: 0, tvaCentimes: 0, ...o,
  })
}

/** La déclaration figée telle que la base la relit : le contenu passé par JSON. */
function figee<C extends ContenuDuCalcul>(d: DeclarationEreporting<C>, o: Partial<DeclarationEreportingHorsApplication> = {}) {
  return {
    objet: d.objet, periode_debut: '2027-10-01', periode_fin: '2027-10-31', regime_id: R, cree_le: DECLAREE_LE,
    contenu: JSON.parse(JSON.stringify(contenuADeclarer(d))) as Record<string, unknown>, ...o,
  }
}

function causesDe(o: Partial<ContexteDesCauses> = {}): ContexteDesCauses {
  return {
    regimes: lu([{ id: R, retire_le: null }]),
    ecarts: lu([]),
    fiches: lu([
      { id: F1, piece_id: P1, cree_le: AVANT, retire_le: null }, { id: F2, piece_id: P2, cree_le: AVANT, retire_le: null },
    ]),
    ...o,
  }
}

describe('etatDeLaDeclaration — à jour, à rectifier, ou indéterminé [DG] [C]', () => {
  const declaree = figee(calculAchats([achatDeclare()]))

  it('à jour : ce qui a été déclaré est ce que l’application calcule aujourd’hui', () => {
    expect(etatDeLaDeclaration(declaree, calculAchats([achatDeclare()]), causesDe()))
      .toEqual({ etat: 'a_jour', differences: [], causes: [], refus: [], motifs: [] })
  })

  it('un achat ajouté, un retiré, un changé : opération par opération, dans l’ordre des jours', () => {
    const deux = figee(calculAchats([achatDeclare(), achatDeclare({ ficheId: F2, pieceId: P2, date: '2027-10-02', numero: 'INV-2' })]))
    const aujourdhui = calculAchats([achatDeclare({ numero: 'INV-1B' }), achatDeclare({ ficheId: F3, pieceId: P3, date: '2027-10-20', numero: 'INV-3' })])
    const fiches = lu([...causesDe().fiches.lignes, { id: F3, piece_id: P3, cree_le: AVANT, retire_le: null }])
    expect(etatDeLaDeclaration(deux, aujourdhui, causesDe({ fiches }))).toEqual({
      etat: 'a_rectifier',
      differences: [
        { sorte: 'retiree', cle: P2, date: '2027-10-02', champs: [], sourcesAjoutees: [], sourcesRetirees: [{ genre: 'fiche', id: F2 }] },
        { sorte: 'changee', cle: P1, date: '2027-10-05', champs: ['numero'], sourcesAjoutees: [], sourcesRetirees: [] },
        { sorte: 'ajoutee', cle: P3, date: '2027-10-20', champs: [], sourcesAjoutees: [{ genre: 'fiche', id: F3 }], sourcesRetirees: [] },
      ],
      causes: [], refus: [], motifs: [],
    })
  })

  it('une nouvelle version de la fiche, aux mêmes données : aucun écart d’opération, mais la cause est dite', () => {
    const fiches = lu([{ id: F1, piece_id: P1, cree_le: AVANT, retire_le: null }, { id: F1B, piece_id: P1, cree_le: APRES, retire_le: null }])
    expect(etatDeLaDeclaration(declaree, calculAchats([achatDeclare({ ficheId: F1B })]), causesDe({ fiches }))).toEqual({
      etat: 'a_rectifier', differences: [], causes: [{ cause: 'fiche_changee_apres', pieceId: P1, ficheId: F1B, le: APRES }], refus: [], motifs: [],
    })
    // Retirée depuis : la cause, et l'achat qui sort.
    const retiree = lu([{ id: F1, piece_id: P1, cree_le: AVANT, retire_le: APRES }])
    const e = etatDeLaDeclaration(declaree, calculAchats([]), causesDe({ fiches: retiree }))
    expect(e.causes).toEqual([{ cause: 'fiche_changee_apres', pieceId: P1, ficheId: F1, le: APRES }])
    expect(e.differences.map((d) => [d.sorte, d.cle])).toEqual([['retiree', P1]])
  })

  it('le régime retiré, un écart repris, une fiche posée après : « à rectifier », jamais un refus (E5-Q7, [C] § 3)', () => {
    const regimes = lu([{ id: R, retire_le: APRES }])
    expect(etatDeLaDeclaration(declaree, calculAchats([achatDeclare()]), causesDe({ regimes })).causes)
      .toEqual([{ cause: 'regime_retire', regimeId: R, le: APRES }])
    // Une pièce écartée au moment de la déclaration, reprise depuis : le calcul d'aujourd'hui l'attend.
    const attend: RefusEreporting = { cle: 'achat_a_verifier', message: 'À vérifier.', sources: [{ genre: 'piece', id: P3 }] }
    const ecarts = lu([{ piece_id: P3, cree_le: AVANT, retire_le: APRES }, { piece_id: P2, cree_le: AVANT, retire_le: APRES }])
    const incomplet = calculAchats([achatDeclare()], { etat: 'incomplete', refus: [attend] })
    expect(etatDeLaDeclaration(declaree, incomplet, causesDe({ ecarts }))).toEqual({
      etat: 'a_rectifier', differences: [], causes: [{ cause: 'ecart_retire', pieceId: P3, le: APRES }], refus: [attend], motifs: [],
    })
    // Un écart posé après la déclaration, ou repris avant elle, n'est pas une cause.
    expect(etatDeLaDeclaration(declaree, incomplet, causesDe({ ecarts: lu([{ piece_id: P3, cree_le: APRES, retire_le: APRES }]) })).etat).toBe('indetermine')
    expect(etatDeLaDeclaration(declaree, incomplet, causesDe({ ecarts: lu([{ piece_id: P3, cree_le: '2027-10-01T10:00:00Z', retire_le: AVANT }]) })).etat)
      .toBe('indetermine')
    // Une pièce dont une fiche existait déjà quand la période a été déclarée : sa nouvelle version n'est pas une fiche posée après.
    const versions = lu([...causesDe().fiches.lignes, { id: F3, piece_id: P3, cree_le: AVANT, retire_le: null }, { id: u(35), piece_id: P3, cree_le: APRES, retire_le: null }])
    const avecP3 = etatDeLaDeclaration(declaree, calculAchats([achatDeclare(), achatDeclare({ ficheId: u(35), pieceId: P3, numero: 'INV-3' })]), causesDe({ fiches: versions }))
    expect(avecP3.causes).toEqual([])
    expect(avecP3.differences.map((d) => [d.sorte, d.cle])).toEqual([['ajoutee', P3]])
    // Une fiche posée après la déclaration, sur un achat de la période.
    const fiches = lu([...causesDe().fiches.lignes, { id: F3, piece_id: P3, cree_le: APRES, retire_le: null }])
    const e = etatDeLaDeclaration(declaree, calculAchats([achatDeclare(), achatDeclare({ ficheId: F3, pieceId: P3, numero: 'INV-3' })]), causesDe({ fiches }))
    expect(e.causes).toEqual([{ cause: 'fiche_posee_apres', pieceId: P3, ficheId: F3, le: APRES }])
    expect(e.differences.map((d) => [d.sorte, d.cle])).toEqual([['ajoutee', P3]])
  })

  it('indéterminé sur une lecture partielle, un contenu figé illisible, un calcul d’aujourd’hui incomplet sans cause', () => {
    const partielle = etatDeLaDeclaration(declaree, calculAchats([achatDeclare()]), causesDe({ fiches: { lignes: [], complete: false, motif: '1 ligne(s) lue(s) sur 2' } }))
    expect(partielle.etat).toBe('indetermine')
    expect(partielle.motifs).toEqual(["La lecture des fiches « fournisseur établi hors de France » n'est pas revenue entière (1 ligne(s) lue(s) sur 2)."])
    expect(etatDeLaDeclaration({ ...declaree, contenu: { achats: 'non' } }, calculAchats([achatDeclare()]), causesDe()).etat).toBe('indetermine')
    const arret = calculAchats([], { contenu: null, refus: [{ cle: 'lecture_incomplete', message: 'x', sources: [] }] })
    expect(etatDeLaDeclaration(declaree, arret, causesDe())).toEqual({ etat: 'indetermine', differences: [], causes: [], refus: arret.refus, motifs: [] })
    expect(etatDeLaDeclaration(declaree, arret, causesDe({ regimes: lu([{ id: R, retire_le: APRES }]) })).etat).toBe('a_rectifier')
    expect(() => etatDeLaDeclaration(declaree, calculVentes([transaction()]), causesDe())).toThrow()
  })

  it('les ventes : un agrégat par jour, catégorie et option ; une facture qui en sort, des montants qui changent ; le déclarant', () => {
    const ventes = figee(calculVentes([transaction({ factures: [FV, FB] })]))
    const e = etatDeLaDeclaration(ventes, calculVentes([transaction({ htCentimes: 5000, tvaCentimes: 1000, parTaux: [{ taux: 20, baseCentimes: 5000, tvaCentimes: 1000 }] })], { siren: '987654321' }), causesDe())
    expect(e.etat).toBe('a_rectifier')
    expect(e.differences).toEqual([
      { sorte: 'changee', cle: 'declarant', date: null, champs: ['siren'], sourcesAjoutees: [], sourcesRetirees: [] },
      { sorte: 'changee', cle: '2027-10-08|TPS1|false', date: '2027-10-08', champs: ['htCentimes', 'parTaux', 'tvaCentimes'], sourcesAjoutees: [], sourcesRetirees: [{ genre: 'facture', id: FB }] },
    ])
    // Une facture d'une autre catégorie le même jour est un autre agrégat.
    const deux = etatDeLaDeclaration(ventes, calculVentes([transaction({ factures: [FV, FB] }), transaction({ categorie: 'TLB1', factures: [u(43)] })]), causesDe())
    expect(deux.differences.map((d) => [d.sorte, d.cle])).toEqual([['ajoutee', '2027-10-08|TLB1|false']])
  })
})
