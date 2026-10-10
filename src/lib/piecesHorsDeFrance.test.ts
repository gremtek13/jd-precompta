import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TAUX_ADMIS } from './factureCii'
import {
  argumentsDeLaFiche, argumentsDuRetrait, CLES_DE_LIGNE_VENTILATION, CODES_TVA_HORS_DE_FRANCE, ETATS_MEMBRES_HORS_FRANCE,
  ficheCourante, montantDansSaDevise, MOTIF_VATEX, NATURES_ACHAT, NUMERO_G105, NUMERO_TVA_UNION,
  OUTRE_MER_FACTURE_ELECTRONIQUE, OUTRE_MER_HORS_FICHE, PAYS_ISO_3166, prefixeTva, REFUS_FICHE_HORS_DE_FRANCE,
  REFUS_RETRAIT_FICHE, refusFicheHorsDeFrance, refusRetraitFiche, TYPES_DE_PIECE_DECRITS, TYPES_DOCUMENT_ECRITS,
  type ContexteFiche, type LigneVentilation, type SaisieFiche,
} from './piecesHorsDeFrance'
import type { EcritureBrouillon, Immobilisation, PieceHorsDeFrance, TypePiece } from './types'
import { piecesFigees } from './validationExercice'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LA FICHE « FOURNISSEUR ÉTABLI HORS DE FRANCE » D'UNE PIÈCE (ligne 28.5, étape e2), confrontée à ce qui fait foi : la
// migration `pieces_hors_de_france` — le texte de `enregistrer_fiche_hors_de_france` et de `retirer_fiche_hors_de_france`
// que l'export porte — pour l'ordre et les mots des refus, leurs valeurs, les listes et les bornes ; l'essai joué en
// production (supabase/essais/piecesHorsDeFrance.sql) pour ce que la base a RÉPONDU : chacun de ses appels aux deux
// fonctions est rejoué ici, sur le même jeu et dans le même ordre, et le module doit dire ce que la base a dit — le refus,
// au mot et à la valeur près, ou rien quand elle a accepté.

const ESSAI = readFileSync(new URL('../../supabase/essais/piecesHorsDeFrance.sql', import.meta.url), 'utf8')

// Le jour où l'essai a été joué en production : sa date « de demain » en découle.
const AUJOURD_HUI = '2026-10-10'
const DEMAIN = '2026-10-11'

type PieceDecrite = Parameters<typeof refusFicheHorsDeFrance>[0]

function piece(o: Partial<PieceDecrite> = {}): PieceDecrite {
  return { id: 'p1', type_piece: 'achat', devise: 'EUR', montant_ttc: 120, montant_devise: null, montant_tva: null, ...o }
}

function ligne(o: Partial<LigneVentilation> = {}): LigneVentilation {
  return { code: 'AE', taux: 0, base: 120, tva: 0, ...o }
}

// Un service acheté à un fournisseur irlandais, autoliquidé : ce que la base accepte.
function saisie(o: Partial<SaisieFiche> = {}): SaisieFiche {
  return {
    numero: 'INV-1', date_facture: '2026-03-10', type_document: '380', facture_origine_numero: null, facture_origine_date: null,
    pays: 'IE', schema_identifiant: '0223', identifiant: 'IE6388047V', nature: 'services', autoliquidation: true,
    date_operation: null, periode_debut: null, periode_fin: null, taux: [ligne()], ...o,
  }
}

function contexte(o: Partial<ContexteFiche> = {}): ContexteFiche {
  return { remplaceId: null, fiches: [], anneeFigeante: null, aujourdHui: AUJOURD_HUI, ...o }
}

function fiche(o: Partial<PieceHorsDeFrance> = {}): PieceHorsDeFrance {
  return {
    id: 'f1', dossier_id: 'd1', piece_id: 'p1', remplace_id: null, numero: 'INV-1', date_facture: '2026-03-10',
    type_document: '380', facture_origine_numero: null, facture_origine_date: null, devise: 'EUR', pays: 'IE',
    schema_identifiant: '0223', identifiant: 'IE6388047V', nature: 'services', autoliquidation: true, date_operation: null,
    periode_debut: null, periode_fin: null, cree_par: 'u1', cree_le: '2026-03-11T10:00:00Z', retire_le: null, retire_par: null,
    ...o,
  }
}

const modele = (cle: string) => REFUS_FICHE_HORS_DE_FRANCE.find((r) => r.cle === cle)?.modele
const modeleDuRetrait = (cle: string) => REFUS_RETRAIT_FICHE.find((r) => r.cle === cle)?.modele

// ── La migration et l'essai, lus ─────────────────────────────────────────────────────────────────────────────────────

const sqlDeLEnregistrement = () => derniereDefinitionSql('enregistrer_fiche_hors_de_france')
const sqlDuRetrait = () => derniereDefinitionSql('retirer_fiche_hors_de_france')

function migration(): string {
  const f = fichiersDuSchema().find((x) => x.texte.includes('create table public.pieces_hors_de_france ('))
  expect(f, 'la migration de la fiche dans l’export').toBeDefined()
  return f?.texte ?? ''
}

// Les messages des `raise exception` d'une fonction, dans l'ordre du texte, l'apostrophe doublée de SQL rendue simple.
function messagesSql(sql: string): string[] {
  return [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
}

// Les codes des refus, dans l'ordre du texte.
function codesSql(sql: string): string[] {
  return [...sql.matchAll(/raise exception '(?:[^']|'')*'[\s\S]*?using errcode = '(\w+)'/g)].map((m) => m[1])
}

// Ce qui suit le message d'un `raise exception`, jusqu'à `using errcode` : les valeurs qui remplissent ses « % »,
// découpées sur les virgules de premier niveau, hors chaînes.
function argumentsSql(sql: string): string[][] {
  return [...sql.matchAll(/raise exception '(?:[^']|'')*'([\s\S]*?)using errcode/g)].map((m) => {
    const texte = m[1].replace(/\s+/g, ' ').trim().replace(/^,\s*/, '')
    return texte ? decouper(texte) : []
  })
}

// Un texte SQL découpé sur ses virgules de premier niveau, hors chaînes (une apostrophe doublée ouvre et referme).
function decouper(texte: string): string[] {
  const valeurs: string[] = []
  let profondeur = 0
  let chaine = false
  let courant = ''
  for (const car of texte) {
    if (car === "'") chaine = !chaine
    if (!chaine && car === '(') profondeur++
    if (!chaine && car === ')') profondeur--
    if (!chaine && profondeur === 0 && car === ',') {
      valeurs.push(courant.trim())
      courant = ''
    } else courant += car
  }
  valeurs.push(courant.trim())
  return valeurs
}

// Une étape du moteur de l'essai : `array['controle', '15. …', 'chef', $q$…$q$, '22023', 'message']` — son genre, son
// titre (son numéro, ou le nom qu'elle retient), son profil, sa requête, le code attendu (« OK » pour un appel qui doit
// passer) et le message attendu de la base (un motif LIKE quand il porte un « % »), l'apostrophe doublée rendue simple.
interface Etape { genre: string; titre: string; numero: string; profil: string; appel: string; code: string; attendu: string }

const GENRES = 'jeu|controle|fait|valeur|retenir|lecture'

function etapesDe(essai: string): Etape[] {
  return [...essai.matchAll(new RegExp(`array\\['(${GENRES})', '((?:[^']|'')*)', '(\\w+)', \\$q\\$([\\s\\S]*?)\\$q\\$,\\s*'(\\w*)',\\s*'((?:[^']|'')*)'`, 'g'))]
    .map(([, genre, titre, profil, appel, code, attendu]) => ({
      genre, titre, numero: /^(\w+)\./.exec(titre)?.[1] ?? '', profil, appel, code, attendu: attendu.replace(/''/g, "'"),
    }))
}

function etape(numero: string): Etape {
  const trouvees = etapesDe(ESSAI).filter((e) => e.numero === numero)
  expect(trouvees, `l’étape ${numero} de l’essai`).toHaveLength(1)
  return trouvees[0]
}

// Le message que l'essai attend de la base — qu'elle a rendu en production — comparé à celui que le module écrirait :
// égal, ou conforme au motif LIKE de l'essai quand il en porte un (« % » pour toute suite, « _ » pour un caractère).
function commeLaBase(e: Etape, recu: string | null | undefined) {
  if (!/[%_]/.test(e.attendu)) {
    expect(recu, e.titre).toBe(e.attendu)
    return
  }
  const motif = e.attendu.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '[\\s\\S]*').replace(/_/g, '.')
  expect(new RegExp(`^${motif}$`).test(recu ?? ''), `${e.titre} : « ${recu} » contre « ${e.attendu} »`).toBe(true)
}

// Les arguments d'un appel `select fonction(…)` de l'essai, ou null si l'étape n'appelle pas cette fonction.
function argumentsDeLAppel(appel: string, fonction: string): string[] | null {
  const debut = `select ${fonction}(`
  if (!appel.startsWith(debut) || !appel.endsWith(')')) return null
  return decouper(appel.slice(debut.length, -1))
}

// Une valeur SQL de l'essai : null, un booléen, `repeat(…)`, un JSON, un texte — un identifiant jetable entre accolades
// rendu par son nom (ou sa valeur retenue).
function valeurSql(expression: string, noms: ReadonlyMap<string, string>): unknown {
  if (expression === 'null') return null
  if (expression === 'true' || expression === 'false') return expression === 'true'
  if (/^-?\d+(?:\.\d+)?$/.test(expression)) return Number(expression)
  const repete = /^repeat\('(\w)', (\d+)\)$/.exec(expression)
  if (repete) return repete[1].repeat(Number(repete[2]))
  const json = /^'([\s\S]*)'::jsonb$/.exec(expression)
  if (json) return JSON.parse(json[1].replace(/''/g, "'")) as unknown
  const texte = /^'([\s\S]*)'$/.exec(expression)
  if (!texte) throw new Error(`Valeur SQL que le test ne sait pas lire : ${expression}`)
  const valeur = texte[1].replace(/''/g, "'")
  const nom = /^\{(\w+)\}$/.exec(valeur)
  if (!nom) return valeur
  const resolu = noms.get(nom[1])
  if (resolu === undefined) throw new Error(`Identifiant jetable inconnu : ${valeur}`)
  return resolu
}

// Les n-uplets d'un `values (…), (…)`, chacun découpé sur ses virgules de premier niveau, hors chaînes.
function nUplets(texte: string): string[][] {
  const sortie: string[][] = []
  let profondeur = 0
  let chaine = false
  let courant = ''
  for (const car of texte) {
    if (car === "'") chaine = !chaine
    if (!chaine && car === '(' && ++profondeur === 1) {
      courant = ''
      continue
    }
    if (!chaine && car === ')' && --profondeur === 0) {
      sortie.push(decouper(courant))
      continue
    }
    if (profondeur > 0) courant += car
  }
  return sortie
}

// Les lignes qu'une étape `jeu` insère dans une table, colonne par colonne.
function lignesInserees(appel: string, table: string, noms: ReadonlyMap<string, string>): Record<string, unknown>[] {
  const lignes: Record<string, unknown>[] = []
  for (const m of appel.matchAll(new RegExp(String.raw`insert into ${table} \(([^)]*)\) values([^;]*)`, 'g'))) {
    const colonnes = m[1].split(',').map((c) => c.trim())
    for (const valeurs of nUplets(m[2])) {
      expect(valeurs, `${table} : ${valeurs.join(', ')}`).toHaveLength(colonnes.length)
      lignes.push(Object.fromEntries(colonnes.map((c, i) => [c, valeurSql(valeurs[i], noms)])))
    }
  }
  return lignes
}

const TYPES_DE_PIECE: readonly TypePiece[] = ['achat', 'vente', 'note_frais', 'autre']
const nombre = (v: unknown) => (v == null ? null : Number(v))
const texteDe = (v: unknown) => (v == null ? null : String(v))

// ── Le rejeu de l'essai ──────────────────────────────────────────────────────────────────────────────────────────────

// Ce que l'essai a construit en base au moment de chaque étape : ses dossiers, ses pièces, ses fiches — celles des étapes
// `fait` seulement, un `controle` s'annule —, ses écritures et son bien. Les profils qui n'ont pas accès au dossier sont
// ceux du moteur de l'essai : le client (sauf `client_v` sur V… que la fonction refuse aussi, il n'est pas du cabinet),
// le compte rattaché à rien, l'anonyme, un membre affecté ailleurs.
interface Rejeu {
  etape: Etape
  fonction: 'enregistrer' | 'retirer'
  /** Ce que la base a fait de l'appel, et ce que le module en dit. */
  base: string
  module: string | null
}

function rejouerLEssai(essai: string): { rejeux: Rejeu[]; figees: Map<string, number> } {
  const noms = new Map<string, string>([['DEMAIN', DEMAIN]])
  // Le dossier du client existe avant l'essai : il n'est pas jetable.
  const dossiers = new Set<string>(['DC'])
  const pieces = new Map<string, PieceDecrite & { dossier_id: string }>()
  const fiches: PieceHorsDeFrance[] = []
  const ecritures: Pick<EcritureBrouillon, 'dossier_id' | 'statut' | 'date' | 'piece_id' | 'immobilisation_id'>[] = []
  const immobilisations: Pick<Immobilisation, 'id' | 'piece_id'>[] = []
  const rejeux: Rejeu[] = []
  // Les identifiants jetables sont désignés par leur nom : on les résout vers lui-même, sauf ceux que l'essai retient.
  for (const m of essai.matchAll(/'\{(\w+)\}'/g)) if (!noms.has(m[1])) noms.set(m[1], m[1])
  const figees = () => piecesFigees(ecritures, immobilisations)

  for (const e of etapesDe(essai)) {
    if (e.genre === 'jeu') {
      for (const d of lignesInserees(e.appel, 'dossiers', noms)) dossiers.add(String(d.id))
      for (const p of lignesInserees(e.appel, 'pieces', noms)) {
        const type = TYPES_DE_PIECE.find((t) => t === p.type_piece)
        expect(type, String(p.type_piece)).toBeDefined()
        pieces.set(String(p.id), {
          id: String(p.id), dossier_id: String(p.dossier_id), type_piece: type ?? 'autre', devise: String(p.devise),
          montant_ttc: nombre(p.montant_ttc), montant_devise: nombre(p.montant_devise), montant_tva: nombre(p.montant_tva),
        })
      }
      for (const i of lignesInserees(e.appel, 'immobilisations', noms)) immobilisations.push({ id: String(i.id), piece_id: texteDe(i.piece_id) })
      for (const x of lignesInserees(e.appel, 'ecritures_brouillon', noms)) {
        ecritures.push({
          dossier_id: String(x.dossier_id), statut: 'proposee', date: String(x.date), piece_id: texteDe(x.piece_id),
          immobilisation_id: texteDe(x.immobilisation_id),
        })
      }
      continue
    }
    if (e.genre === 'retenir') {
      const m = /^select id::text from pieces_hors_de_france where (piece_id|remplace_id) = '\{(\w+)\}'$/.exec(e.appel)
      expect(m, e.appel).not.toBeNull()
      const trouvees = fiches.filter((f) => (m?.[1] === 'piece_id' ? f.piece_id : f.remplace_id) === noms.get(m?.[2] ?? ''))
      expect(trouvees, `retenir ${e.titre}`).toHaveLength(1)
      noms.set(e.titre, trouvees[0].id)
      continue
    }
    const validation = /^select valider_exercice\('\{(\w+)\}', (\d{4}),/.exec(e.appel)
    if (validation && e.genre === 'fait') {
      // La validation fige les écritures de l'exercice : les seules que l'essai pose dans ce dossier.
      for (const x of ecritures) {
        if (x.dossier_id === noms.get(validation[1]) && x.date <= `${validation[2]}-12-31`) x.statut = 'validee'
      }
      continue
    }

    const enregistrement = argumentsDeLAppel(e.appel, 'enregistrer_fiche_hors_de_france')
    const retrait = argumentsDeLAppel(e.appel, 'retirer_fiche_hors_de_france')
    if (!enregistrement && !retrait) continue
    const valeurs = (enregistrement ?? retrait ?? []).map((v) => valeurSql(v, noms))
    const dossier = String(valeurs[0])
    const accesRefuse = ['anon', 'inconnu', 'client', 'client_v'].includes(e.profil) || !dossiers.has(dossier)
      || (e.profil === 'membre' && dossier !== noms.get('T')) || (e.profil === 'membre_ailleurs' && dossier !== noms.get('A'))
    const base = e.code === 'OK' ? 'OK' : `${e.code} ${e.attendu}`
    const fichesDuDossier = fiches.filter((f) => f.dossier_id === dossier)

    if (enregistrement) {
      expect(valeurs, e.titre).toHaveLength(17)
      const pieceId = String(valeurs[1])
      const p = pieces.get(pieceId)
      let dit: string | null
      if (accesRefuse) dit = 'acces'
      else if (!p || p.dossier_id !== dossier) dit = 'piece_introuvable'
      else {
        const s: SaisieFiche = {
          numero: texteDe(valeurs[3]), date_facture: texteDe(valeurs[4]), type_document: texteDe(valeurs[5]),
          facture_origine_numero: texteDe(valeurs[6]), facture_origine_date: texteDe(valeurs[7]), pays: texteDe(valeurs[8]),
          schema_identifiant: texteDe(valeurs[9]), identifiant: texteDe(valeurs[10]), nature: texteDe(valeurs[11]),
          autoliquidation: valeurs[12] == null ? null : valeurs[12] === true, date_operation: texteDe(valeurs[13]),
          periode_debut: texteDe(valeurs[14]), periode_fin: texteDe(valeurs[15]),
          // Le JSON tel que l'essai l'envoie, liste ou non : c'est ce que le module doit savoir juger.
          taux: valeurs[16] as readonly LigneVentilation[],
        }
        const r = refusFicheHorsDeFrance(p, s, contexte({
          remplaceId: texteDe(valeurs[2]), fiches: fichesDuDossier, anneeFigeante: figees().get(pieceId) ?? null,
        }))
        dit = r ? `22023 ${r.message}` : 'OK'
        if (e.genre === 'fait' && dit === 'OK') {
          fiches.push(fiche({
            id: `fiche-${e.numero}`, dossier_id: dossier, piece_id: pieceId, remplace_id: texteDe(valeurs[2]),
            numero: String(s.numero), date_facture: String(s.date_facture), schema_identifiant: s.schema_identifiant === '0227' ? '0227' : '0223',
            identifiant: String(s.identifiant),
          }))
        }
      }
      rejeux.push({ etape: e, fonction: 'enregistrer', base, module: dit })
      continue
    }

    const f = fichesDuDossier.find((x) => x.id === String(valeurs[1]))
    let dit: string | null
    if (accesRefuse) dit = 'acces'
    else if (!f) dit = 'fiche_introuvable'
    else {
      const r = refusRetraitFiche(f, fichesDuDossier, figees().get(f.piece_id) ?? null)
      dit = r ? `22023 ${r.message}` : 'OK'
      if (e.genre === 'fait' && dit === 'OK') f.retire_le = '2026-10-10T08:00:00Z'
    }
    rejeux.push({ etape: e, fonction: 'retirer', base, module: dit })
  }
  return { rejeux, figees: figees() }
}

// ── Les refus de l'enregistrement, confrontés au texte de la base ─────────────────────────────────────────────────

describe('enregistrer_fiche_hors_de_france — le module dit ce que la fonction refuse', () => {
  it('les mêmes messages, dans le même ordre', () => {
    const sql = sqlDeLEnregistrement()
    expect(messagesSql(sql)).toHaveLength(48)
    expect(REFUS_FICHE_HORS_DE_FRANCE.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(new Set(REFUS_FICHE_HORS_DE_FRANCE.map((r) => r.cle)).size).toBe(REFUS_FICHE_HORS_DE_FRANCE.length)
  })

  it('l’accès et la pièce introuvable d’abord, sous leurs codes ; tout le reste en 22023', () => {
    const codes = codesSql(sqlDeLEnregistrement())
    expect(codes).toHaveLength(REFUS_FICHE_HORS_DE_FRANCE.length)
    expect(codes.slice(0, 2)).toEqual(['42501', 'P0002'])
    expect(new Set(codes.slice(2))).toEqual(new Set(['22023']))
    expect(REFUS_FICHE_HORS_DE_FRANCE.slice(0, 2).map((r) => r.cle)).toEqual(['acces', 'piece_introuvable'])
  })

  // LA BORNE DU HARNAIS : une confrontation qui ne saurait pas virer au rouge ne prouverait rien.
  it('vire au rouge sur une dérive plantée dans le texte de la fonction', () => {
    const sql = sqlDeLEnregistrement()
    const attendu = REFUS_FICHE_HORS_DE_FRANCE.map((r) => r.modele)
    const mot = sql.replace("'Dire si le dossier autoliquide la TVA de cet achat.'", "'Dire si le dossier autoliquide la TVA.'")
    expect(mot).not.toBe(sql)
    expect(messagesSql(mot)).not.toEqual(attendu)
    const a = "raise exception 'La date de la facture est à renseigner.'"
    const b = "raise exception 'Une facture ne se date pas avant l''an 2000.'"
    expect(sql).toContain(a)
    expect(sql).toContain(b)
    expect(messagesSql(sql.replace(a, '§').replace(b, a).replace('§', b))).not.toEqual(attendu)
  })

  it('les valeurs des messages sont celles que le module écrit', () => {
    const MONTANT = (x: string) => `replace(to_char(${x}, 'FM999999999990.00'), '.', ',')`
    const attendus: Record<string, string[]> = {
      piece_figee: ['v_annee'],
      ttc_absent: ['v_piece.devise'],
      tva_sur_la_piece: [MONTANT('abs(v_piece.montant_tva)')],
      date_future: ["to_char(v_aujourd_hui, 'DD/MM/YYYY')"],
      numero_tva_invalide: ['p_pays', "case when p_pays = 'GR' then 'EL' else p_pays end"],
      identifiant_hors_union_invalide: ['p_pays'],
      ligne_repetee: ['v_ligne.code', "replace(trim_scale(v_ligne.taux)::text, '.', ',')"],
      code_inconnu: ['v_code'],
      taux_ou_tva: ['v_code'],
      ventilation_hors_ttc: [MONTANT('v_somme'), 'v_piece.devise', MONTANT('abs(v_ttc)'), 'v_piece.devise'],
    }
    const args = argumentsSql(sqlDeLEnregistrement())
    expect(args).toHaveLength(REFUS_FICHE_HORS_DE_FRANCE.length)
    REFUS_FICHE_HORS_DE_FRANCE.forEach((r, i) => {
      expect(args[i], r.cle).toEqual(attendus[r.cle] ?? [])
      expect(r.modele.replace(/%%/g, '').split('%').length - 1, r.cle).toBe(args[i].length)
    })
  })

  it('l’écran envoie exactement les paramètres de la fonction, dans leur ordre', () => {
    const signature = /function public\.enregistrer_fiche_hors_de_france\(([^)]*)\)/.exec(sqlDeLEnregistrement())
    expect(signature).not.toBeNull()
    const parametres = (signature?.[1] ?? '').split(',').map((p) => p.trim().split(/\s+/)[0])
    expect(parametres).toHaveLength(17)
    expect(Object.keys(argumentsDeLaFiche('d1', 'p1', null, saisie()))).toEqual(parametres)
    const retrait = /function public\.retirer_fiche_hors_de_france\(([^)]*)\)/.exec(sqlDuRetrait())
    expect(Object.keys(argumentsDuRetrait('d1', 'f1'))).toEqual((retrait?.[1] ?? '').split(',').map((p) => p.trim().split(/\s+/)[0]))
  })

  // Les listes, les motifs et les bornes que la fonction tient : un code renommé d'un seul côté ferait refuser par la base
  // ce que l'écran propose, ou proposer ce qu'elle refuse.
  it('les listes et les motifs de la fonction sont ceux du module', () => {
    const sql = sqlDeLEnregistrement()
    const liste = (nom: string) => {
      const m = new RegExp(`${nom} constant text\\[\\] := array\\[([^\\]]*)\\]`).exec(sql)
      expect(m, nom).not.toBeNull()
      return [...(m?.[1] ?? '').matchAll(/'([A-Z]{2})'/g)].map((x) => x[1])
    }
    expect(liste('c_pays')).toEqual([...PAYS_ISO_3166])
    expect(liste('c_union')).toEqual([...ETATS_MEMBRES_HORS_FRANCE])
    expect(liste('c_drom_tva')).toEqual([...OUTRE_MER_FACTURE_ELECTRONIQUE])
    expect(liste('c_outre_mer')).toEqual([...OUTRE_MER_HORS_FICHE])
    expect(sql).toContain(`v_numero_g105 constant text := '${NUMERO_G105.source}';`)
    expect(sql).toContain(`p_identifiant !~ '${NUMERO_TVA_UNION.source}'`)
    expect(sql).toContain(`(e.v ->> 'motif_code') !~ '${MOTIF_VATEX.source}'`)
    expect(sql).toContain(`p_type_document not in (${TYPES_DOCUMENT_ECRITS.map((t) => `'${t}'`).join(', ')})`)
    expect(sql).toContain(`e.v ->> 'code' not in (${CODES_TVA_HORS_DE_FRANCE.map((t) => `'${t}'`).join(', ')})`)
    expect(sql).toContain(`p_nature not in (${NATURES_ACHAT.map((t) => `'${t}'`).join(', ')})`)
    expect(sql).toContain(`k.cle not in (${CLES_DE_LIGNE_VENTILATION.map((t) => `'${t}'`).join(', ')})`)
    expect(sql).toContain(`v_piece.type_piece not in (${TYPES_DE_PIECE_DECRITS.map((t) => `'${t}'`).join(', ')})`)
    // Les bornes, et le jour lu à Paris.
    expect(sql).toContain('char_length(p_numero) > 35')
    expect(sql).toContain("char_length(e.v ->> 'motif_code') > 30")
    expect(sql).toContain("char_length(e.v ->> 'motif_texte') > 1024")
    expect(sql).toContain('char_length(p_identifiant) not between 3 and 18')
    expect(sql).toContain("(e.v ->> 'base')::numeric < 10000000000000")
    expect(sql).toContain('if abs(v_somme - abs(v_ttc)) > 0.01 then')
    expect(sql).toContain("v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;")
    expect(sql).toContain("v_ttc := case when v_piece.devise = 'EUR' then v_piece.montant_ttc else v_piece.montant_devise end;")
  })

  it('les listes du module tiennent debout seules', () => {
    // 249 codes attribués, triés, sans doublon : la France, Monaco et l'outre-mer en sont, comme les 26 autres États
    // membres — l'Union en compte 27 avec la France.
    expect(PAYS_ISO_3166).toHaveLength(249)
    expect([...PAYS_ISO_3166].sort()).toEqual([...PAYS_ISO_3166])
    expect(new Set(PAYS_ISO_3166).size).toBe(249)
    for (const p of PAYS_ISO_3166) expect(p).toMatch(/^[A-Z]{2}$/)
    for (const p of ['FR', 'MC', ...ETATS_MEMBRES_HORS_FRANCE, ...OUTRE_MER_FACTURE_ELECTRONIQUE, ...OUTRE_MER_HORS_FICHE]) {
      expect(PAYS_ISO_3166, p).toContain(p)
    }
    expect(ETATS_MEMBRES_HORS_FRANCE).toHaveLength(26)
    expect(ETATS_MEMBRES_HORS_FRANCE).not.toContain('FR')
    // XI (l'Irlande du Nord) et EL (le préfixe grec) ne sont pas des codes de pays de l'ISO 3166.
    expect(PAYS_ISO_3166).not.toContain('XI')
    expect(PAYS_ISO_3166).not.toContain('EL')
  })

  it('la table admet tout ce que la fonction écrit, sous les mêmes listes', () => {
    const texte = migration()
    const entre = (contrainte: string) => {
      const m = new RegExp(`constraint ${contrainte}\\s+check \\(\\w+ in \\(([^)]*)\\)\\)`).exec(texte)
      expect(m, contrainte).not.toBeNull()
      return decouper(m?.[1] ?? '').map((v) => v.replace(/^'|'$/g, ''))
    }
    expect(entre('pieces_hors_de_france_taux_code')).toEqual([...CODES_TVA_HORS_DE_FRANCE])
    expect(entre('pieces_hors_de_france_nature')).toEqual([...NATURES_ACHAT])
    expect(entre('pieces_hors_de_france_schema')).toEqual(['0223', '0227'])
    for (const t of TYPES_DOCUMENT_ECRITS) expect(entre('pieces_hors_de_france_type_document')).toContain(t)
    // Le taux : la liste de la règle G1.24, celle de la facture électronique.
    expect(entre('pieces_hors_de_france_taux_taux').map(Number).sort((a, b) => a - b)).toEqual([...TAUX_ADMIS].sort((a, b) => a - b))
    expect(texte).toContain(`numero ~ '${NUMERO_G105.source}'`)
    expect(texte).toContain(`facture_origine_numero ~ '${NUMERO_G105.source}'`)
    expect(texte).toContain(`motif_code ~ '${MOTIF_VATEX.source}'`)
  })

  // LE GEL EST CELUI DE LA PIÈCE : `exercice_figeant_la_piece` reprend la requête de `garder_piece_validee`, et l'écran
  // le lit par `piecesFigees` (lib/validationExercice.ts), qui le recopie — confronté plus bas au rejeu de l'essai.
  it('l’exercice qui fige la fiche est celui qui fige sa pièce', () => {
    const normaliser = (s: string) => s.replace(/\s+/g, ' ').replace(/ into v_annee/, '').replace(/old\.id/g, 'p_piece_id').trim()
    const gel = /function public\.exercice_figeant_la_piece[\s\S]*?as \$\$([\s\S]*?)\$\$;/.exec(migration())
    const piece = /function public\.garder_piece_validee[\s\S]*?(select min\(extract\(year from e\.date\)\)::integer into v_annee[\s\S]*?);/
      .exec(fichiersDuSchema().filter((f) => f.texte.includes('function public.garder_piece_validee')).map((f) => f.texte).pop() ?? '')
    expect(gel).not.toBeNull()
    expect(piece).not.toBeNull()
    expect(normaliser(gel?.[1] ?? '')).toBe(normaliser(piece?.[1] ?? ''))
  })
})

describe('retirer_fiche_hors_de_france — le module dit ce que la fonction refuse', () => {
  it('les mêmes messages, dans le même ordre, et leurs valeurs', () => {
    const sql = sqlDuRetrait()
    expect(REFUS_RETRAIT_FICHE.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(codesSql(sql)).toEqual(['42501', 'P0002', '22023', '22023', '22023'])
    expect(argumentsSql(sql)).toEqual([[], [], [], [], ['v_annee']])
  })

  it('dans l’ordre de la fonction : remplacée, déjà retirée, figée', () => {
    const f = fiche({ id: 'f1', retire_le: '2026-04-01T10:00:00Z' })
    const suite = fiche({ id: 'f2', remplace_id: 'f1' })
    expect(refusRetraitFiche(f, [f, suite], 2025)?.cle).toBe('remplacee')
    expect(refusRetraitFiche(f, [f], 2025)?.cle).toBe('deja_retiree')
    expect(refusRetraitFiche({ ...f, retire_le: null }, [f], 2025)?.message)
      .toBe("Cette pièce porte une écriture validée de l'exercice 2025 : sa fiche ne se retire plus.")
    expect(refusRetraitFiche({ ...f, retire_le: null }, [f], null)).toBeNull()
  })
})

// ── Ce que la base a répondu, rejoué ─────────────────────────────────────────────────────────────────────────────────

describe('l’essai joué en production, rejoué étape par étape', () => {
  const { rejeux, figees } = rejouerLEssai(ESSAI)

  it('lit toutes les étapes de l’essai', () => {
    // Le plancher qui distingue « aucun écart » d'« aveugle » : chaque étape écrite est une étape lue.
    const ecrites = ESSAI.match(new RegExp(`array\\['(?:${GENRES})'`, 'g')) ?? []
    expect(etapesDe(ESSAI)).toHaveLength(ecrites.length)
    expect(ecrites.length).toBeGreaterThanOrEqual(200)
    expect(rejeux.filter((r) => r.fonction === 'enregistrer').length).toBeGreaterThanOrEqual(105)
    expect(rejeux.filter((r) => r.fonction === 'retirer').length).toBeGreaterThanOrEqual(7)
  })

  it('chaque appel que l’écran peut faire : le refus de la base, au mot et à la valeur près, ou rien quand elle a accepté', () => {
    const dits = rejeux.filter((r) => r.module !== 'acces' && r.module !== 'piece_introuvable' && r.module !== 'fiche_introuvable')
    // Les deux côtés : ce que la base a accepté, et ce qu'elle a refusé.
    expect(dits.filter((r) => r.etape.code === 'OK').length).toBeGreaterThanOrEqual(20)
    expect(dits.filter((r) => r.etape.code !== 'OK').length).toBeGreaterThanOrEqual(80)
    for (const r of dits) {
      if (r.etape.code === 'OK') {
        expect(r.module, `${r.etape.titre} : la base a accepté`).toBe('OK')
        continue
      }
      expect(r.etape.code, r.etape.titre).toBe('22023')
      expect(r.module?.startsWith('22023 '), `${r.etape.titre} : la base a refusé, le module n’a rien dit`).toBe(true)
      commeLaBase(r.etape, r.module?.slice(6))
    }
  })

  it('ceux que l’écran ne peut pas dire ont les codes et les mots de la base', () => {
    const nonDits = rejeux.filter((r) => r.module === 'acces' || r.module === 'piece_introuvable' || r.module === 'fiche_introuvable')
    expect(nonDits.length).toBeGreaterThanOrEqual(11)
    for (const r of nonDits) {
      if (r.etape.profil === 'anon') {
        // L'anonyme n'a pas même le droit d'appeler : c'est Postgres qui parle.
        expect(r.base, r.etape.titre).toMatch(/^42501 permission denied for function /)
        continue
      }
      const cle = r.module ?? ''
      const attendu = r.fonction === 'enregistrer' ? modele(cle) : modeleDuRetrait(cle)
      expect(r.etape.code, r.etape.titre).toBe(cle === 'acces' ? '42501' : 'P0002')
      commeLaBase(r.etape, attendu)
    }
  })

  it('chaque refus des deux fonctions a été lu au moins une fois en base', () => {
    const lus = new Set<string>()
    for (const r of rejeux) {
      if (r.module == null || r.module === 'OK') continue
      if (!r.module.startsWith('22023 ')) {
        lus.add(`${r.fonction}:${r.module}`)
        continue
      }
      const message = r.module.slice(6)
      const refus = r.fonction === 'enregistrer' ? REFUS_FICHE_HORS_DE_FRANCE : REFUS_RETRAIT_FICHE
      const cle = refus.find((x) => new RegExp(`^${x.modele.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%%/g, '%').replace(/%/g, '[\\s\\S]*')}$`).test(message))?.cle
      lus.add(`${r.fonction}:${cle}`)
    }
    expect([...lus].filter((c) => c.startsWith('enregistrer:')).sort())
      .toEqual(REFUS_FICHE_HORS_DE_FRANCE.map((r) => `enregistrer:${r.cle}`).sort())
    expect([...lus].filter((c) => c.startsWith('retirer:')).sort())
      .toEqual(REFUS_RETRAIT_FICHE.map((r) => `retirer:${r.cle}`).sort())
  })

  it('les pièces que la validation fige sont celles que la base a dites (contrôle 139)', () => {
    expect(etape('139').attendu).toBe('2025:2025:-')
    expect([figees.get('PV') ?? '-', figees.get('PI') ?? '-', figees.get('P1') ?? '-'].join(':')).toBe('2025:2025:-')
  })

  it('un message de l’essai changé d’un mot, ou une étape qui passait et ne passe plus, se voit', () => {
    const planter = (avant: string, apres: string) => {
      expect(ESSAI).toContain(avant)
      return rejouerLEssai(ESSAI.replace(avant, apres)).rejeux
    }
    const mot = planter("'22023', 'Dire si le dossier autoliquide la TVA de cet achat.'],", "'22023', 'Dire si le dossier autoliquide la TVA.'],")
    const r53 = mot.find((r) => r.etape.numero === '53')
    expect(r53?.module).toBe('22023 Dire si le dossier autoliquide la TVA de cet achat.')
    expect(() => commeLaBase(r53?.etape ?? etape('53'), r53?.module?.slice(6))).toThrow()
    const ok = planter(
      `'[{"code":"AE","taux":0,"base":299.99,"tva":0}]'::jsonb)$q$, 'OK', ''],`,
      `'[{"code":"AE","taux":0,"base":299.98,"tva":0}]'::jsonb)$q$, 'OK', ''],`,
    )
    expect(ok.find((r) => r.etape.numero === '72b')?.module).toMatch(/^22023 La ventilation \(299,98 EUR\)/)
  })
})

// ── refusFicheHorsDeFrance ────────────────────────────────────────────────────────────────────────────────────────

describe('refusFicheHorsDeFrance — dit avant le clic ce que la base refuserait, sous ses mots', () => {
  it('rien à redire de ce que la base accepte', () => {
    expect(refusFicheHorsDeFrance(piece(), saisie(), contexte())).toBeNull()
    // Un service acheté aux États-Unis, en dollars, hors du champ ; un bien acheté en Allemagne, livré ; un avoir ; une note
    // de frais ; un fournisseur grec sous son préfixe EL ; une exonération que le dossier n'autoliquide pas.
    expect(refusFicheHorsDeFrance(piece({ devise: 'USD', montant_ttc: 85.47, montant_devise: 99.99, montant_tva: 0 }),
      saisie({ pays: 'US', schema_identifiant: '0227', identifiant: 'USACME SOFTWARE IN', taux: [ligne({ code: 'O', base: 99.99 })] }),
      contexte())).toBeNull()
    expect(refusFicheHorsDeFrance(piece(), saisie({ pays: 'DE', identifiant: 'DE123456789', nature: 'biens',
      date_operation: '2026-03-08', taux: [ligne({ code: 'K' })] }), contexte())).toBeNull()
    expect(refusFicheHorsDeFrance(piece({ montant_ttc: -50 }), saisie({ type_document: '381', facture_origine_numero: 'INV-0',
      facture_origine_date: '2026-02-10', taux: [ligne({ base: 50 })] }), contexte())).toBeNull()
    expect(refusFicheHorsDeFrance(piece({ type_piece: 'note_frais' }), saisie(), contexte())).toBeNull()
    expect(refusFicheHorsDeFrance(piece(), saisie({ pays: 'GR', identifiant: 'EL123456789' }), contexte())).toBeNull()
    expect(refusFicheHorsDeFrance(piece(), saisie({ autoliquidation: false,
      taux: [ligne({ code: 'E', motif_code: 'VATEX-EU-132', motif_texte: 'Exonération' })] }), contexte())).toBeNull()
  })

  // Chaque pas corrige le défaut qu'il vient de dire, et laisse tous ceux qui suivent : le refus rendu doit être le
  // suivant. Avec l'égalité des listes ci-dessus, l'ordre de l'écran est celui des `raise` de la fonction.
  it('dans l’ordre de la fonction', () => {
    let p = piece({ type_piece: 'vente', devise: 'USD', montant_ttc: 102.5, montant_devise: null, montant_tva: 5 })
    let s = saisie({
      numero: ' ', date_facture: null, type_document: '386', pays: 'XX', schema_identifiant: '0002', identifiant: ' ',
      nature: 'logiciel', autoliquidation: null, date_operation: '2026-03-10', periode_debut: '2026-03-01', periode_fin: null, taux: [],
    })
    const courante = fiche({ id: 'f0', piece_id: 'p1' })
    const autre = fiche({ id: 'g0', piece_id: 'p2', numero: 'inv-1', date_facture: '2026-01-05', identifiant: 'DE123456789' })
    let c = contexte({ remplaceId: 'x', fiches: [courante, autre], anneeFigeante: 2025 })
    const motif = { motif_code: 'VATEX-EU-132', motif_texte: 'Exonération' }
    const pas: (() => void)[] = [
      () => { p = { ...p, type_piece: 'achat' } },
      () => { c = { ...c, anneeFigeante: null } },
      () => { p = { ...p, montant_devise: 120 } },
      () => { p = { ...p, montant_tva: 0 } },
      () => { c = { ...c, remplaceId: null } },
      () => { c = { ...c, remplaceId: 'f0' } },
      () => { s = { ...s, numero: 'INV.1' } },
      () => { s = { ...s, numero: 'INV-1' } },
      () => { s = { ...s, date_facture: '1999-12-31' } },
      () => { s = { ...s, date_facture: DEMAIN } },
      () => { s = { ...s, date_facture: '2026-03-10' } },
      () => { s = { ...s, type_document: '381' } },
      () => { p = { ...p, montant_devise: -120 } },
      () => { s = { ...s, facture_origine_numero: 'F.1', facture_origine_date: '2026-01-10' } },
      () => { s = { ...s, type_document: '380', facture_origine_numero: 'F-1' }; p = { ...p, montant_devise: 120 } },
      () => { s = { ...s, facture_origine_numero: null, facture_origine_date: null } },
      () => { s = { ...s, pays: 'FR' } },
      () => { s = { ...s, pays: 'MC' } },
      () => { s = { ...s, pays: 'GP' } },
      () => { s = { ...s, pays: 'NC' } },
      () => { s = { ...s, pays: 'DE' } },
      () => { s = { ...s, schema_identifiant: '0227' } },
      () => { s = { ...s, pays: 'US', schema_identifiant: '0223' } },
      () => { s = { ...s, pays: 'DE' } },
      () => { s = { ...s, identifiant: 'NL123456789B01' } },
      () => { s = { ...s, pays: 'US', schema_identifiant: '0227', identifiant: 'ACME' } },
      () => { s = { ...s, identifiant: 'USACME' } },
      () => { s = { ...s, nature: 'services' } },
      () => { s = { ...s, autoliquidation: false } },
      () => { s = { ...s, date_operation: null } },
      () => { s = { ...s, periode_debut: '2100-01-01', periode_fin: '2100-01-31' } },
      () => { s = { ...s, periode_debut: '2026-03-01', periode_fin: '2026-03-31' } },
      () => { s = { ...s, taux: [ligne({ code: 'X' }), ligne({ code: 'X' })] } },
      () => { s = { ...s, taux: [ligne({ code: 'X' })] } },
      () => { s = { ...s, taux: [ligne({ code: 'S', taux: 20, tva: 20 })] } },
      () => { s = { ...s, taux: [ligne({ code: 'O', taux: 20 })] } },
      () => { s = { ...s, taux: [ligne({ code: 'O', base: -1 })] } },
      () => { s = { ...s, taux: [ligne({ code: 'E' })] } },
      () => { s = { ...s, taux: [ligne({ code: 'E', motif_code: 'EXO', motif_texte: 'Exonération' })] } },
      () => { s = { ...s, taux: [ligne({ code: 'E', base: 60, ...motif }), ligne({ code: 'Z', base: 60, motif_texte: 'Taux zéro' })] } },
      () => { s = { ...s, taux: [ligne({ code: 'E', base: 60, ...motif }), ligne({ code: 'Z', base: 60 })] } },
      () => { s = { ...s, pays: 'DE', schema_identifiant: '0223', identifiant: 'DE123456789', taux: [ligne({ base: 60 }), ligne({ code: 'Z', base: 60 })] } },
      () => { s = { ...s, autoliquidation: true, taux: [ligne({ code: 'E', base: 60, ...motif }), ligne({ code: 'Z', base: 60 })] } },
      () => { s = { ...s, taux: [ligne({ base: 60 }), ligne({ code: 'Z', base: 50 })] } },
      () => { s = { ...s, taux: [ligne({ base: 60 }), ligne({ code: 'Z', base: 60 })] } },
      () => { c = { ...c, fiches: [courante, { ...autre, retire_le: '2026-04-01T10:00:00Z' }] } },
    ]
    const vus = [refusFicheHorsDeFrance(p, s, c)?.cle ?? 'aucun']
    for (const corriger of pas) {
      corriger()
      vus.push(refusFicheHorsDeFrance(p, s, c)?.cle ?? 'aucun')
    }
    const dits = REFUS_FICHE_HORS_DE_FRANCE.map((r) => r.cle as string).filter((cle) => cle !== 'acces' && cle !== 'piece_introuvable')
    expect(vus).toEqual([...dits, 'aucun'])
  })

  it('une date qui n’est pas une date civile n’est pas renseignée — ni envoyée', () => {
    for (const date of [null, '', '10/03/2026', '2026-3-10', '2026-02-30', '2026-13-01']) {
      expect(refusFicheHorsDeFrance(piece(), saisie({ date_facture: date }), contexte())?.cle, String(date)).toBe('date_absente')
      expect(argumentsDeLaFiche('d1', 'p1', null, saisie({ date_facture: date })).p_date_facture, String(date)).toBeNull()
    }
    // Une date de livraison impossible n'est pas une date : la période reste seule, et rien ne se refuse.
    expect(refusFicheHorsDeFrance(piece(), saisie({ date_operation: '2026-02-30', periode_debut: '2026-02-01', periode_fin: '2026-02-28' }),
      contexte())).toBeNull()
    expect(argumentsDeLaFiche('d1', 'p1', 'f0', saisie({ date_operation: '2026-02-29' }))).toMatchObject({ p_remplace_id: 'f0', p_date_operation: null })
  })

  it('les bornes des dates sont celles de la base : l’an 2000 compris, aujourd’hui à Paris compris, 2099 compris', () => {
    expect(refusFicheHorsDeFrance(piece(), saisie({ date_facture: '2000-01-01' }), contexte())).toBeNull()
    expect(refusFicheHorsDeFrance(piece(), saisie({ date_facture: AUJOURD_HUI }), contexte())).toBeNull()
    expect(refusFicheHorsDeFrance(piece(), saisie({ date_facture: DEMAIN }), contexte())?.message)
      .toBe("Une facture ne se date pas dans l'avenir : nous sommes le 10/10/2026.")
    expect(refusFicheHorsDeFrance(piece(), saisie({ date_operation: '2099-12-31' }), contexte())).toBeNull()
    expect(refusFicheHorsDeFrance(piece(), saisie({ date_operation: '1999-12-31' }), contexte())?.cle).toBe('dates_hors_bornes')
    expect(refusFicheHorsDeFrance(piece(), saisie({ periode_debut: '2026-03-31', periode_fin: '2026-03-31' }), contexte())).toBeNull()
  })

  it('le numéro suit G1.05 : trente-cinq caractères, sans accent, des espaces simples, ni en tête ni en fin', () => {
    const dit = (numero: string) => refusFicheHorsDeFrance(piece(), saisie({ numero }), contexte())?.cle ?? 'aucun'
    expect(dit('A'.repeat(35))).toBe('aucun')
    expect(dit('A'.repeat(36))).toBe('numero_invalide')
    expect(dit('INV 2026 1')).toBe('aucun')
    expect(dit('A-1+B_2/C')).toBe('aucun')
    for (const faux of ['INV  1', ' INV-1', 'INV-1 ', 'FACTÉ-1', 'INV.1', 'INV\t1']) expect(dit(faux), faux).toBe('numero_invalide')
    expect(dit('\t \n')).toBe('numero_absent')
  })

  it('l’identifiant suit G2.19 : le numéro de TVA de l’Union, ou le pays et le nom', () => {
    const dit = (pays: string, schema: string, identifiant: string) => refusFicheHorsDeFrance(piece(),
      saisie({ pays, schema_identifiant: schema, identifiant, taux: [ligne({ code: ETATS_MEMBRES_HORS_FRANCE.includes(pays) ? 'AE' : 'O' })] }),
      contexte())?.cle ?? 'aucun'
    expect(dit('DE', '0223', 'DE12')).toBe('aucun')
    expect(dit('DE', '0223', 'DE1')).toBe('numero_tva_invalide')
    expect(dit('DE', '0223', `DE${'1'.repeat(16)}`)).toBe('aucun')
    expect(dit('DE', '0223', `DE${'1'.repeat(17)}`)).toBe('numero_tva_invalide')
    expect(dit('DE', '0223', 'de123456789')).toBe('numero_tva_invalide')
    expect(dit('AT', '0223', 'ATU12345678')).toBe('aucun')
    expect(dit('GR', '0223', 'GR123456789')).toBe('numero_tva_invalide')
    expect(refusFicheHorsDeFrance(piece(), saisie({ pays: 'GR', identifiant: 'GR123456789' }), contexte())?.message)
      .toBe("Le numéro de TVA d'un fournisseur établi dans ce pays (GR) commence par EL et tient en 18 caractères au plus : des lettres sans accent et des chiffres.")
    expect(dit('US', '0227', 'USA')).toBe('aucun')
    expect(dit('US', '0227', 'US')).toBe('identifiant_hors_union_invalide')
    expect(dit('US', '0227', `US${'A'.repeat(16)}`)).toBe('aucun')
    expect(dit('US', '0227', `US${'A'.repeat(17)}`)).toBe('identifiant_hors_union_invalide')
    // La dénomination garde ses accents et ses espaces intérieurs ; seuls l'espace aux bords et les caractères de
    // contrôle sont refusés — les mêmes que la base (U+0000 à U+001F, U+007F à U+009F) ; une espace insécable n'en est
    // pas un, ni une espace sans chasse.
    expect(dit('CH', '0227', 'CHSOCIÉTÉ GÉNÉRALE')).toBe('aucun')
    for (const faux of ['USACME ', ' USACME', 'USACME\t', 'US\u0085ACME', 'US\u007fACME']) {
      expect(dit('US', '0227', faux), JSON.stringify(faux)).toBe('identifiant_hors_union_invalide')
    }
    for (const admis of ['USACME\u00a0', 'US\u200bACME']) expect(dit('US', '0227', admis), JSON.stringify(admis)).toBe('aucun')
    // Le compte est en caractères, comme `char_length` : un caractère hors du plan de base en vaut un.
    expect(dit('US', '0227', `US${'𝔸'.repeat(16)}`)).toBe('aucun')
  })

  it('la ventilation passe par JSON, comme la base la reçoit', () => {
    const dit = (taux: LigneVentilation[]) => refusFicheHorsDeFrance(piece(), saisie({ taux }), contexte())?.cle ?? 'aucun'
    // Un nombre qui n'en est pas un devient null : la ligne est illisible.
    expect(dit([ligne({ base: Number.NaN })])).toBe('ventilation_illisible')
    expect(dit([ligne({ tva: Number.POSITIVE_INFINITY })])).toBe('ventilation_illisible')
    // Un motif indéfini disparaît ; nul, il reste nul : l'un et l'autre sont admis.
    expect(dit([ligne({ motif_code: undefined, motif_texte: null })])).toBe('aucun')
    // Deux lignes du même code au même taux, en ordre de saisie : la première répétée est nommée.
    expect(refusFicheHorsDeFrance(piece(), saisie({ taux: [ligne({ code: 'K', base: 20 }), ligne({ base: 50 }), ligne({ base: 50 }), ligne({ code: 'K', base: 0.5 })] }),
      contexte())?.message).toBe('Le code AE au taux de 0 % figure deux fois dans la ventilation.')
  })

  it('les bornes de la ventilation sont celles de la base', () => {
    const dit = (taux: LigneVentilation[]) => refusFicheHorsDeFrance(piece(), saisie({ taux }), contexte())?.cle ?? 'aucun'
    // Une base sous dix mille milliards : au-delà, la colonne la refuserait.
    expect(dit([ligne({ base: 10_000_000_000_000 })])).toBe('base_invalide')
    expect(dit([ligne({ base: 9_999_999_999_999.99 })])).toBe('ventilation_hors_ttc')
    expect(dit([ligne({ base: 0 })])).toBe('base_invalide')
    // Un code de motif de trente caractères, un libellé de mille vingt-quatre, comptés en caractères.
    expect(dit([ligne({ motif_code: `VATEX-EU-${'A'.repeat(21)}`, motif_texte: 'x' })])).toBe('aucun')
    expect(dit([ligne({ motif_code: `VATEX-EU-${'A'.repeat(22)}`, motif_texte: 'x' })])).toBe('motif_invalide')
    expect(dit([ligne({ motif_code: 'VATEX-EU-AE', motif_texte: 'é'.repeat(1024) })])).toBe('aucun')
    expect(dit([ligne({ motif_code: 'VATEX-EU-AE', motif_texte: 'é'.repeat(1025) })])).toBe('motif_invalide')
    expect(dit([ligne({ motif_code: 'VATEX-EU-AE', motif_texte: ' \t\n' })])).toBe('motif_invalide')
    // Une ligne répétée se dit avec son taux, écrit comme la base l'écrit.
    expect(refusFicheHorsDeFrance(piece(), saisie({ taux: [ligne({ code: 'O', taux: 5.5 }), ligne({ code: 'O', taux: 5.5 })] }), contexte())?.message)
      .toBe('Le code O au taux de 5,5 % figure deux fois dans la ventilation.')
  })

  it('une pièce à zéro n’a pas de sens : ni facture ni avoir n’y est refusé pour le sens, la ventilation le dit', () => {
    expect(refusFicheHorsDeFrance(piece({ montant_ttc: 0 }), saisie(), contexte())?.cle).toBe('ventilation_hors_ttc')
    expect(refusFicheHorsDeFrance(piece({ montant_ttc: 0 }), saisie({ type_document: '381', facture_origine_numero: 'F-1',
      facture_origine_date: '2026-01-10' }), contexte())?.cle).toBe('ventilation_hors_ttc')
  })

  it('la ventilation refait le montant de la pièce, dans sa devise, à un centime près, sans virgule flottante', () => {
    const dit = (o: Partial<PieceDecrite>, taux: LigneVentilation[]) => refusFicheHorsDeFrance(piece(o), saisie({ taux }), contexte())?.message ?? 'aucun'
    expect(dit({}, [ligne({ base: 119.99 })])).toBe('aucun')
    expect(dit({}, [ligne({ base: 120.01 })])).toBe('aucun')
    expect(dit({}, [ligne({ base: 119.98 })])).toBe('La ventilation (119,98 EUR) ne fait pas le montant TTC de la pièce (120,00 EUR), à un centime près.')
    // 0,1 + 0,2 ne vaut pas 0,3 en virgule flottante : en centimes, si.
    expect(dit({ montant_ttc: 0.3 }, [ligne({ base: 0.1 }), ligne({ code: 'O', base: 0.2 })])).toBe('aucun')
    // Un montant en devise n'est pas toujours au centime : la base le compare tel quel, et l'écrit arrondi au plus loin
    // de zéro.
    const usd = (montant_devise: number) => ({ devise: 'USD', montant_ttc: 70, montant_devise })
    expect(dit(usd(80.005), [ligne({ code: 'O', base: 80 })])).toBe('aucun')
    expect(dit(usd(80.005), [ligne({ code: 'O', base: 80.01 })])).toBe('aucun')
    expect(dit(usd(80.005), [ligne({ code: 'O', base: 79.99 })]))
      .toBe('La ventilation (79,99 USD) ne fait pas le montant TTC de la pièce (80,01 USD), à un centime près.')
    expect(dit(usd(0.105), [ligne({ code: 'O', base: 0.12 })]))
      .toBe('La ventilation (0,12 USD) ne fait pas le montant TTC de la pièce (0,11 USD), à un centime près.')
    // Un avoir : la valeur absolue de la pièce.
    expect(refusFicheHorsDeFrance(piece({ montant_ttc: -80.5 }), saisie({ type_document: '381', facture_origine_numero: 'F-1',
      facture_origine_date: '2026-01-10', taux: [ligne({ base: 80 })] }), contexte())?.message)
      .toBe('La ventilation (80,00 EUR) ne fait pas le montant TTC de la pièce (80,50 EUR), à un centime près.')
    // Le plus gros montant qu'une pièce porte en euros.
    expect(dit({ montant_ttc: 9999999999.99 }, [ligne({ base: 9999999999.99 })])).toBe('aucun')
  })

  it('une TVA sur la pièce se dit en valeur absolue, au centime', () => {
    expect(refusFicheHorsDeFrance(piece({ montant_tva: -3.5 }), saisie(), contexte())?.message)
      .toBe('La pièce porte une TVA de 3,50 € : un achat à un fournisseur établi hors de France facturé avec une TVA — la sienne ou la TVA française — est mis de côté, à trancher par le cabinet.')
    expect(refusFicheHorsDeFrance(piece({ montant_tva: 0 }), saisie(), contexte())).toBeNull()
  })

  it('la même facture : numéro, année et fournisseur, sans tenir compte de la casse — sur une autre pièce seulement', () => {
    const dit = (f: Partial<PieceHorsDeFrance>, s: Partial<SaisieFiche> = {}, o: PieceHorsDeFrance[] = []) =>
      refusFicheHorsDeFrance(piece(), saisie(s), contexte({ fiches: [fiche({ id: 'g1', piece_id: 'p2', ...f }), ...o] }))?.cle ?? 'aucun'
    expect(dit({})).toBe('facture_deja_decrite')
    expect(dit({ numero: 'inv-1' })).toBe('facture_deja_decrite')
    expect(dit({ date_facture: '2026-12-31' })).toBe('facture_deja_decrite')
    expect(dit({ date_facture: '2025-03-10' })).toBe('aucun')
    expect(dit({ identifiant: 'IE9999999W' })).toBe('aucun')
    expect(dit({ retire_le: '2026-04-01T10:00:00Z' })).toBe('aucun')
    // Une version remplacée ne garde plus sa facture ; celle qui la remplace, si.
    expect(dit({}, {}, [fiche({ id: 'g2', piece_id: 'p2', remplace_id: 'g1', numero: 'INV-2' })])).toBe('aucun')
    expect(dit({ numero: 'INV-0' }, {}, [fiche({ id: 'g2', piece_id: 'p2', remplace_id: 'g1' })])).toBe('facture_deja_decrite')
    // Comme `upper()` en base (locale ICU, relevé en production) : « ß » vaut « SS ».
    expect(dit({ pays: 'CH', schema_identifiant: '0227', identifiant: 'CHSTRAßE AG' },
      { pays: 'CH', schema_identifiant: '0227', identifiant: 'CHSTRASSE AG', taux: [ligne({ code: 'O' })] })).toBe('facture_deja_decrite')
    // La fiche de la même pièce n'est pas une autre facture : c'est elle qu'on remplace.
    expect(refusFicheHorsDeFrance(piece(), saisie(), contexte({ remplaceId: 'f1', fiches: [fiche()] }))).toBeNull()
  })

  // Ce que l'essai ne distingue pas, et que la fonction distingue : chaque cas fait dire au module ce que la base dirait,
  // là où une règle plus lâche — ou plus stricte — dirait autre chose (la campagne de mutations du module les a trouvés).
  it('les cas que le rejeu de l’essai ne distingue pas', () => {
    const dit = (s: Partial<SaisieFiche>, c: Partial<ContexteFiche> = {}) => refusFicheHorsDeFrance(piece(), saisie(s), contexte(c))
    // Une facture qui ne cite que la DATE d'une facture d'origine en cite une.
    expect(dit({ facture_origine_date: '2026-01-10' })?.cle).toBe('origine_sur_une_facture')
    // Une date de livraison et la seule fin d'une période : les deux.
    expect(dit({ date_operation: '2026-03-08', periode_fin: '2026-03-31' })?.cle).toBe('livraison_et_periode')
    // Le même code à deux taux n'est pas une ligne répétée : c'est le taux qui se refuse.
    expect(dit({ taux: [ligne({ code: 'O', base: 60 }), ligne({ code: 'O', taux: 5.5, base: 60 })] })?.message)
      .toBe("Une ligne O ne porte ni taux ni TVA : sans TVA facturée, l'un et l'autre sont nuls.")
    // La PREMIÈRE ligne fautive, dans l'ordre de la saisie.
    expect(dit({ taux: [ligne({ code: 'K', taux: 5.5, base: 60 }), ligne({ taux: 20, base: 60 })] })?.message)
      .toBe("Une ligne K ne porte ni taux ni TVA : sans TVA facturée, l'un et l'autre sont nuls.")
    expect(dit({ taux: [ligne({ code: 'X', base: 60 }), ligne({ code: 'L', base: 60 })] })?.message)
      .toBe("Le code de TVA « X » n'est pas un code que la facturation électronique admet.")
    // Le même fournisseur, c'est le même schéma ET le même identifiant : une fiche réinsérée telle quelle par une
    // restauration sous un autre schéma n'est pas la même facture pour la base.
    expect(dit({}, { fiches: [fiche({ id: 'g1', piece_id: 'p2', schema_identifiant: '0227' })] })).toBeNull()
  })

  it('la fiche à remplacer est la courante de cette pièce', () => {
    const f1 = fiche({ id: 'f1' })
    const f2 = fiche({ id: 'f2', remplace_id: 'f1', retire_le: '2026-04-01T10:00:00Z' })
    expect(refusFicheHorsDeFrance(piece(), saisie(), contexte({ remplaceId: 'f2', fiches: [f1, f2] }))).toBeNull()
    expect(refusFicheHorsDeFrance(piece(), saisie(), contexte({ remplaceId: 'f1', fiches: [f1, f2] }))?.cle).toBe('fiche_changee')
    expect(refusFicheHorsDeFrance(piece(), saisie(), contexte({ remplaceId: null, fiches: [f1, f2] }))?.cle).toBe('fiche_changee')
    expect(refusFicheHorsDeFrance(piece({ id: 'p9' }), saisie(), contexte({ remplaceId: 'f2', fiches: [f1, f2] }))?.cle).toBe('remplace_etrangere')
  })
})

// ── Les petites fonctions ─────────────────────────────────────────────────────────────────────────────────────────

describe('la fiche courante, le préfixe, le montant', () => {
  it('la courante est celle qu’aucune ne remplace — retirée, elle le reste', () => {
    const chaine = [fiche({ id: 'f3', remplace_id: 'f2', retire_le: '2026-05-01T10:00:00Z' }), fiche({ id: 'f1' }), fiche({ id: 'f2', remplace_id: 'f1' })]
    expect(ficheCourante(chaine, 'p1')).toBe('f3')
    expect(ficheCourante(chaine, 'p2')).toBeNull()
    expect(ficheCourante([], 'p1')).toBeNull()
    expect(ficheCourante([fiche({ id: 'g1', piece_id: 'p2' }), fiche({ id: 'f1' })], 'p1')).toBe('f1')
  })

  it('le préfixe de la Grèce est EL ; les autres, leur code', () => {
    expect(prefixeTva('GR')).toBe('EL')
    for (const p of ETATS_MEMBRES_HORS_FRANCE.filter((x) => x !== 'GR')) expect(prefixeTva(p)).toBe(p)
  })

  it('le montant d’une pièce dans sa devise : en euros, le TTC ; sinon, celui du document', () => {
    expect(montantDansSaDevise({ devise: 'EUR', montant_ttc: 120, montant_devise: null })).toBe(120)
    expect(montantDansSaDevise({ devise: 'USD', montant_ttc: 85.47, montant_devise: 99.99 })).toBe(99.99)
    expect(montantDansSaDevise({ devise: 'USD', montant_ttc: 85.47, montant_devise: null })).toBeNull()
  })

  it('l’écran envoie la saisie telle quelle, les dates civiles seules', () => {
    expect(argumentsDeLaFiche('d1', 'p1', null, saisie({ periode_debut: '2026-03-01', periode_fin: '2026-03-31' }))).toEqual({
      p_dossier_id: 'd1', p_piece_id: 'p1', p_remplace_id: null, p_numero: 'INV-1', p_date_facture: '2026-03-10',
      p_type_document: '380', p_facture_origine_numero: null, p_facture_origine_date: null, p_pays: 'IE',
      p_schema_identifiant: '0223', p_identifiant: 'IE6388047V', p_nature: 'services', p_autoliquidation: true,
      p_date_operation: null, p_periode_debut: '2026-03-01', p_periode_fin: '2026-03-31', p_taux: [ligne()],
    })
    expect(argumentsDuRetrait('d1', 'f1')).toEqual({ p_dossier_id: 'd1', p_fiche_id: 'f1' })
  })
})
