import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TYPES_DE_PIECE_DECRITS } from './piecesHorsDeFrance'
import {
  ARTICLES_D_EXONERATION, LONGUEUR_MAXIMALE_TEXTE, PERIODICITES, REFUS_CONFIRMATION_REGIME, REFUS_ECART_PIECE,
  REFUS_REPRISE_PIECE, REFUS_RETRAIT_REGIME, STATUTS_DU_REGIME, argumentsDeLEcart, argumentsDeLaConfirmation,
  argumentsDeLaReprise, argumentsDuRetraitDuRegime, dossierSousLeRegime, ecartActif, frequencesDuRegime,
  libelleDuRegime, memeRegime, piecesEcarteesActives, refusConfirmationRegime, refusEcartPiece, refusRepriseEcart,
  refusRetraitRegime, regimeDeLaPeriode, regimeEnVigueur, regimeEstLeStatutDuDossier, regimeProposeDuDossier,
  regimesActifs, rythme, type SaisieRegime,
} from './regimesEreporting'
import type { Dossier, PieceEcarteeEreporting, PieceHorsDeFrance, RegimeEreporting, TypePiece } from './types'
import { appelsDe, commeLaBase, etapesDe, lignesInserees, remplacerLesNoms, valeurSql, type Etape } from '../test/essaiSql'
import { argumentsSql, codesSql, messagesSql } from '../test/raiseSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE RÉGIME D'E-REPORTING CONFIRMÉ ET LA PIÈCE ÉCARTÉE (ligne 28.5, étape e5a), confrontés à ce qui fait foi : la migration
// `regimes_ereporting_et_pieces_ecartees` — le texte des quatre fonctions que l'export porte — pour l'ordre et les mots des
// refus, leurs valeurs, leurs codes et leurs paramètres ; l'essai (supabase/essais/regimesEreporting.sql) pour ce que la
// base a RÉPONDU : chacun de ses appels aux quatre fonctions est rejoué ici, sur le même jeu et dans le même ordre, et le
// module doit dire ce que la base a dit — le refus, au mot près, ou rien quand elle a accepté. CHAQUE AUTRE ATTENDU EST
// ÉCRIT À LA MAIN, depuis la source que cite la ligne de commentaire qui le précède. Les sources :
//   [M]  BOI-TVA-DECLA-20-30-50-30, 30/09/2026 : § 40 (la fréquence suit le régime, quelle que soit l'opération), § 50 (la
//        décade au réel normal mensuel), § 60 (le mois au réel normal trimestriel), § 70 (le bimestre civil en franchise) ;
//   [P]  BOI-TVA-DECLA-20-30-60, 30/09/2026 : § 30 (pas de paiements sur option pour les débits), § 170 (chaque mois au
//        réel normal, mensuel ou trimestriel), § 180 (le bimestre civil en franchise) ;
//   [A]  impots.gouv.fr, actualité du 22/09/2026 : « communiquer à leur plateforme agréée leur régime de TVA et tout
//        changement de régime » ;
//   [E1] HISTORIQUE.md, « L'E-REPORTING : L'OBLIGATION DITE JUSTE » : la fréquence d'un exonéré, « chaque mois », à confirmer ;
//   [E2] HISTORIQUE.md, « LA FICHE D'UN ACHAT HORS DE FRANCE, EN BASE » : la chaîne des fiches, la courante, le retrait ;
//   [Q4] la question du 09/10/2026 : la fréquence proposée, que le cabinet confirme (hypothèse de la fonction).

const ESSAI = readFileSync(new URL('../../supabase/essais/regimesEreporting.sql', import.meta.url), 'utf8')

// Le jour de Paris sous lequel le rejeu juge l'essai — celui où il a été joué sur la réplique : un appel daté du lendemain
// est « dans l'avenir », un appel daté de ce jour ne l'est pas.
const AUJOURD_HUI = '2026-10-11'
const DEMAIN = '2026-10-12'

const sqlDe = (nom: string) => derniereDefinitionSql(nom)
const parametresDe = (nom: string) => (/function public\.\w+\(([^)]*)\)/.exec(sqlDe(nom))?.[1] ?? '')
  .split(',').map((p) => p.trim().split(/\s+/)[0])
const modeles = (liste: readonly { modele: string }[]) => liste.map((r) => r.modele)

function migration(): string {
  const f = fichiersDuSchema().find((x) => x.texte.includes('create table public.regimes_ereporting ('))
  expect(f, 'la migration des régimes dans l’export').toBeDefined()
  return f?.texte ?? ''
}

function regime(o: Partial<RegimeEreporting> = {}): RegimeEreporting {
  return {
    id: 'r1', dossier_id: 'd1', depuis: '2027-01-01', statut_tva: 'redevable', article_exoneration: null,
    tva_periodicite: 'trimestrielle', tva_sur_debits: false, frequence_transactions: 'mois', frequence_paiements: 'mois',
    note: null, cree_par: 'u1', cree_le: '2027-01-02T10:00:00Z', retire_le: null, retire_par: null, ...o,
  }
}

const franchise = (o: Partial<RegimeEreporting> = {}) => regime({
  statut_tva: 'franchise', tva_periodicite: null, frequence_transactions: 'bimestre', frequence_paiements: 'bimestre', ...o,
})

type DossierTva = Pick<Dossier, 'id' | 'statut_tva' | 'article_exoneration' | 'tva_periodicite' | 'tva_sur_debits'>

function dossier(o: Partial<DossierTva> = {}): DossierTva {
  return { id: 'd1', statut_tva: 'redevable', article_exoneration: null, tva_periodicite: 'trimestrielle', tva_sur_debits: false, ...o }
}

// Un redevable trimestriel depuis le 1er janvier 2026 : ce que la base accepte le 11/10/2026.
function saisie(o: Partial<SaisieRegime> = {}): SaisieRegime {
  return {
    depuis: '2026-01-01', statut_tva: 'redevable', article_exoneration: null, tva_periodicite: 'trimestrielle',
    tva_sur_debits: false, frequence_transactions: 'mois', frequence_paiements: 'mois', note: null, ...o,
  }
}

const contexte = (regimes: RegimeEreporting[] = []) => ({ dossierId: 'd1', regimes, aujourdHui: AUJOURD_HUI })

function fiche(o: Partial<PieceHorsDeFrance> = {}) {
  return { id: 'f1', piece_id: 'p1', remplace_id: null, retire_le: null, ...o }
}

function ecart(o: Partial<PieceEcarteeEreporting> = {}): PieceEcarteeEreporting {
  return {
    id: 'e1', dossier_id: 'd1', piece_id: 'p1', motif: 'Vérifiée.', cree_par: 'u1', cree_le: '2027-10-06T10:00:00Z',
    retire_le: null, retire_par: null, ...o,
  }
}

// ── Les refus, confrontés au texte de la base ───────────────────────────────────────────────────────────────────────

describe('les quatre fonctions — le module dit leurs refus, dans leur ordre et sous leurs mots', () => {
  it('confirmer_regime_ereporting : les mêmes messages, les mêmes codes, les mêmes valeurs', () => {
    const sql = sqlDe('confirmer_regime_ereporting')
    expect(messagesSql(sql)).toEqual(modeles(REFUS_CONFIRMATION_REGIME))
    expect(codesSql(sql)).toEqual(['42501', ...Array<string>(REFUS_CONFIRMATION_REGIME.length - 1).fill('22023')])
    // Les valeurs des « % » : le jour à Paris et le jour de départ en JJ/MM/AAAA, puis le rythme refait par la fonction.
    const valeurs = argumentsSql(sql)
    expect(valeurs[3]).toEqual(["to_char(v_aujourd_hui, 'DD/MM/YYYY')"])
    expect(valeurs[4]).toEqual(["to_char(p_depuis, 'DD/MM/YYYY')"])
    expect(valeurs[12]).toEqual(["case v_transactions when 'decade' then 'par décade' when 'mois' then 'chaque mois' else 'tous les deux mois' end"])
    expect(valeurs[14]).toEqual(["case v_paiements when 'mois' then 'chaque mois' else 'tous les deux mois' end"])
    expect(valeurs.filter((_, i) => ![3, 4, 12, 14].includes(i)).every((v) => v.length === 0)).toBe(true)
    expect(sql).toContain("v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;")
    // Une note faite d'espaces n'est pas une note : la fonction la tient pour nulle, puis la mesure.
    expect(sql).toContain("v_note text := case when btrim(p_note) = '' then null else p_note end;")
    expect(sql).toContain('if length(v_note) > 2000 then')
  })

  it('le rythme du module est celui que la fonction écrit dans ses refus', () => {
    // [M] § 50 à § 70 et [P] § 170, § 180 : par décade, chaque mois, tous les deux mois.
    expect(rythme('decade')).toBe('par décade')
    expect(rythme('mois')).toBe('chaque mois')
    expect(rythme('bimestre')).toBe('tous les deux mois')
  })

  it('confirmer_regime_ereporting : les paramètres, dans l’ordre de sa signature', () => {
    const parametres = parametresDe('confirmer_regime_ereporting')
    expect(Object.keys(argumentsDeLaConfirmation('d1', saisie()))).toEqual(parametres)
    expect(parametres).toHaveLength(9)
  })

  it('les listes et les fréquences de la fonction et de la table sont celles que le module lit', () => {
    const plat = sqlDe('confirmer_regime_ereporting').replace(/\s+/g, ' ')
    const table = migration().replace(/\s+/g, ' ')
    expect(plat).toContain("p_statut_tva not in ('redevable', 'franchise', 'exonere')")
    expect(STATUTS_DU_REGIME).toEqual(['redevable', 'franchise', 'exonere'])
    const articles = `(${ARTICLES_D_EXONERATION.map((a) => `'${a}'`).join(', ')})`
    expect(plat).toContain(`p_article_exoneration not in ${articles}`)
    expect(table).toContain(`check (article_exoneration in ${articles})`)
    const periodicites = `(${PERIODICITES.map((p) => `'${p}'`).join(', ')})`
    expect(plat).toContain(`p_tva_periodicite not in ${periodicites}`)
    expect(table).toContain(`check (tva_periodicite in ${periodicites})`)
    // Les fréquences que la fonction refait — `frequencesDuRegime` les dit, cas par cas, plus bas, depuis les textes.
    expect(plat).toContain("v_transactions := case p_statut_tva when 'redevable' then case p_tva_periodicite when 'mensuelle' "
      + "then 'decade' else 'mois' end when 'franchise' then 'bimestre' else 'mois' end;")
    expect(plat).toContain("v_paiements := case when p_statut_tva = 'redevable' and p_tva_sur_debits then null "
      + "when p_statut_tva = 'franchise' then 'bimestre' else 'mois' end;")
    // Et celles que la table tient sans la fonction : l'exonéré seul y est libre (hypothèse Q4).
    expect(table).toContain("constraint regimes_ereporting_frequences_ecrites check ( case statut_tva when 'redevable' then "
      + "frequence_transactions = case tva_periodicite when 'mensuelle' then 'decade' else 'mois' end and frequence_paiements "
      + "is not distinct from case when tva_sur_debits then null else 'mois' end when 'franchise' then frequence_transactions = "
      + "'bimestre' and frequence_paiements = 'bimestre' else frequence_paiements is not null end)")
    expect(table).toContain("check (btrim(note) <> '' and length(note) <= 2000)")
    expect(table).toContain("check (btrim(motif) <> '' and length(motif) <= 2000)")
    expect(LONGUEUR_MAXIMALE_TEXTE).toBe(2000)
  })

  it('retirer_regime_ereporting, ecarter_piece_ereporting, reprendre_piece_ereporting : les mêmes messages et codes', () => {
    const retrait = sqlDe('retirer_regime_ereporting')
    expect(messagesSql(retrait)).toEqual(modeles(REFUS_RETRAIT_REGIME))
    expect(codesSql(retrait)).toEqual(['42501', 'P0002', '22023'])
    const ecarter = sqlDe('ecarter_piece_ereporting')
    expect(messagesSql(ecarter)).toEqual(modeles(REFUS_ECART_PIECE))
    expect(codesSql(ecarter)).toEqual(['42501', 'P0002', '22023', '22023', '22023', '22023', '22023', '22023'])
    const reprendre = sqlDe('reprendre_piece_ereporting')
    expect(messagesSql(reprendre)).toEqual(modeles(REFUS_REPRISE_PIECE))
    expect(codesSql(reprendre)).toEqual(['42501', 'P0002', '22023'])
    for (const sql of [retrait, ecarter, reprendre]) expect(argumentsSql(sql).every((v) => v.length === 0)).toBe(true)
    // Les candidates sont les pièces d'une fiche « hors de France » (étape e2) : un achat, une note de frais.
    expect(ecarter).toContain(`v_piece.type_piece not in (${TYPES_DE_PIECE_DECRITS.map((t) => `'${t}'`).join(', ')})`)
    // La fiche courante : celle qu'aucune autre ne remplace ([E2]) ; le motif, mesuré comme la note.
    expect(ecarter).toContain('and not exists (select 1 from public.pieces_hors_de_france s where s.remplace_id = f.id);')
    expect(ecarter).toContain("if p_motif is null or btrim(p_motif) = '' then")
    expect(ecarter).toContain('if length(p_motif) > 2000 then')
  })

  it('les paramètres des trois autres, dans l’ordre de leur signature', () => {
    expect(Object.keys(argumentsDuRetraitDuRegime('d1', 'r1'))).toEqual(parametresDe('retirer_regime_ereporting'))
    expect(Object.keys(argumentsDeLEcart('d1', 'p1', 'm'))).toEqual(parametresDe('ecarter_piece_ereporting'))
    expect(Object.keys(argumentsDeLaReprise('d1', 'e1'))).toEqual(parametresDe('reprendre_piece_ereporting'))
  })
})

// ── L'essai, rejoué ─────────────────────────────────────────────────────────────────────────────────────────────────

interface Rejeu {
  etape: Etape
  fonction: string
  /** Ce que la base a fait de l'appel : « OK », ou le code et le message (motif LIKE) que l'essai a exigés. */
  base: string
  /** Ce que le module en dit : `acces` et `introuvable` (que l'écran ne peut pas dire, et l'essai juge à leur code), `OK`,
   * ou la clé de son refus. */
  cle: string
  message: string | null
}

const texteDe = (v: unknown) => (v == null ? null : String(v))
const TYPES_DE_PIECE: readonly TypePiece[] = ['achat', 'vente', 'note_frais', 'autre']

/**
 * L'essai rejoué : ce qu'il a construit en base au moment de chaque étape — ses dossiers et ses pièces, les fiches que ses
 * étapes `fait` posent ou retirent, les régimes et les écarts qu'elles écrivent (un `controle` s'annule) — et, pour chaque
 * appel aux quatre fonctions, ce que le module en dit. Les profils et leurs accès sont ceux du moteur de l'essai : le chef
 * (super-administrateur) et le chef simple partout dans le cabinet, le membre dans T seul, le membre d'ailleurs dans A seul,
 * le client, le compte rattaché à rien et l'anonyme nulle part ; un dossier qui n'existe pas, pour personne.
 */
function rejouer(essai: string): Rejeu[] {
  const noms = new Map<string, string>([['AUJOURDHUI', AUJOURD_HUI], ['DEMAIN', DEMAIN], ['CHEF', 'chef']])
  for (const m of essai.matchAll(/\{(\w+)\}/g)) if (!noms.has(m[1])) noms.set(m[1], m[1])
  // Le dossier du client existe avant l'essai : il n'est pas jetable.
  const dossiers = new Set<string>(['DC'])
  const pieces = new Map<string, { id: string; dossier_id: string; type_piece: TypePiece }>()
  const fiches: { id: string; dossier_id: string; piece_id: string; remplace_id: string | null; retire_le: string | null }[] = []
  const regimes: { id: string; dossier_id: string; depuis: string; retire_le: string | null }[] = []
  const ecarts: { id: string; dossier_id: string; piece_id: string; retire_le: string | null }[] = []
  const rejeux: Rejeu[] = []
  let compteur = 0
  const RETIRE = '2026-10-11T08:00:00Z'
  // Une sous-requête de l'essai rend la ligne qu'elle trouve, rien, ou lève quand elle en trouve plusieurs : comme la base.
  const auPlusUne = (trouvees: { id: string }[], texte: string) => {
    if (trouvees.length > 1) throw new Error(`Sous-requête à plusieurs lignes : ${texte}`)
    return trouvees[0]?.id ?? null
  }
  const sousRequete = (texte: string): unknown => {
    const r = /^\(select id from regimes_ereporting where dossier_id = '(\w+)' and depuis = '([\d-]+)'\)$/.exec(texte)
    if (r) return auPlusUne(regimes.filter((x) => x.dossier_id === r[1] && x.depuis === r[2]), texte)
    const e = /^\(select id from pieces_ecartees_ereporting where piece_id = '(\w+)'\)$/.exec(texte)
    if (e) return auPlusUne(ecarts.filter((x) => x.piece_id === e[1]), texte)
    throw new Error(`Sous-requête que le test ne sait pas lire : ${texte}`)
  }
  const retenue = (trouvees: { id: string }[], quoi: string): string => {
    expect(trouvees, quoi).toHaveLength(1)
    return trouvees[0]?.id ?? ''
  }

  for (const e of etapesDe(essai)) {
    if (e.genre === 'jeu') {
      for (const d of lignesInserees(e.appel, 'dossiers', noms)) dossiers.add(String(d.id))
      for (const p of lignesInserees(e.appel, 'pieces', noms)) {
        const type = TYPES_DE_PIECE.find((t) => t === p.type_piece)
        if (type == null) throw new Error(`Type de pièce inconnu : ${String(p.type_piece)}`)
        pieces.set(String(p.id), { id: String(p.id), dossier_id: String(p.dossier_id), type_piece: type })
      }
      continue
    }
    if (e.genre === 'retenir') {
      const appel = remplacerLesNoms(e.appel, noms)
      let m: RegExpExecArray | null
      if ((m = /^select id::text from pieces_hors_de_france where (piece_id|remplace_id) = '([\w-]+)'$/.exec(appel))) {
        const [, colonne, valeur] = m
        noms.set(e.titre, retenue(fiches.filter((f) => (colonne === 'piece_id' ? f.piece_id : f.remplace_id) === valeur), appel))
      } else if ((m = /^select id::text from regimes_ereporting where dossier_id = '(\w+)' and depuis = '([\d-]+)'$/.exec(appel))) {
        const [, d, depuis] = m
        noms.set(e.titre, retenue(regimes.filter((r) => r.dossier_id === d && r.depuis === depuis), appel))
      } else if ((m = /^select id::text from pieces_ecartees_ereporting where piece_id = '(\w+)'$/.exec(appel))) {
        const piece = m[1]
        noms.set(e.titre, retenue(ecarts.filter((x) => x.piece_id === piece), appel))
      } else throw new Error(`Étape « retenir » que le test ne sait pas lire : ${e.appel}`)
      continue
    }
    if (e.genre !== 'fait' && e.genre !== 'controle') continue
    const appels = appelsDe(e.appel)
    // Une écriture directe juge la garde et les contraintes, pas le module.
    if (appels == null) continue
    const fait = e.genre === 'fait'
    // Une étape `fait` doit passer : sinon le jeu rejoué ne serait plus celui de la base.
    if (fait) expect(e.code, e.titre).toBe('OK')
    const base = e.code === 'OK' ? 'OK' : `${e.code} ${e.attendu}`
    for (const { fonction, arguments: brut } of appels) {
      const v = brut.map((x) => valeurSql(x, noms, sousRequete))
      const dossier = String(v[0])
      const accesRefuse = ['anon', 'inconnu', 'client'].includes(e.profil) || !dossiers.has(dossier)
        || (e.profil === 'membre' && dossier !== noms.get('T')) || (e.profil === 'membre_ailleurs' && dossier !== noms.get('A'))
      const dire = (cle: string, refus: { cle: string; message: string } | null = null) =>
        rejeux.push({ etape: e, fonction, base, cle: refus?.cle ?? cle, message: refus?.message ?? null })
      if (fonction === 'enregistrer_fiche_hors_de_france') {
        if (fait) fiches.push({ id: `fiche-${++compteur}`, dossier_id: dossier, piece_id: String(v[1]), remplace_id: texteDe(v[2]), retire_le: null })
      } else if (fonction === 'retirer_fiche_hors_de_france') {
        const f = fiches.find((x) => x.id === v[1])
        if (fait && f) f.retire_le = RETIRE
      } else if (fonction === 'confirmer_regime_ereporting') {
        expect(v, e.titre).toHaveLength(9)
        const s: SaisieRegime = {
          depuis: texteDe(v[1]), statut_tva: texteDe(v[2]), article_exoneration: texteDe(v[3]), tva_periodicite: texteDe(v[4]),
          tva_sur_debits: v[5] == null ? null : v[5] === true, frequence_transactions: texteDe(v[6]),
          frequence_paiements: texteDe(v[7]), note: texteDe(v[8]),
        }
        if (accesRefuse) dire('acces')
        else {
          const refus = refusConfirmationRegime(s, { dossierId: dossier, regimes, aujourdHui: AUJOURD_HUI })
          dire('OK', refus)
          if (fait && refus == null) regimes.push({ id: `regime-${++compteur}`, dossier_id: dossier, depuis: String(s.depuis), retire_le: null })
        }
      } else if (fonction === 'retirer_regime_ereporting') {
        const r = regimes.find((x) => x.id === v[1] && x.dossier_id === dossier)
        if (accesRefuse) dire('acces')
        else if (r == null) dire('introuvable')
        else {
          const refus = refusRetraitRegime(r)
          dire('OK', refus)
          if (fait && refus == null) r.retire_le = RETIRE
        }
      } else if (fonction === 'ecarter_piece_ereporting') {
        const p = pieces.get(String(v[1]))
        if (accesRefuse) dire('acces')
        else if (p == null || p.dossier_id !== dossier) dire('introuvable')
        else {
          const refus = refusEcartPiece(p, texteDe(v[2]), {
            fiches: fiches.filter((f) => f.dossier_id === dossier), ecarts: ecarts.filter((x) => x.dossier_id === dossier),
          })
          dire('OK', refus)
          if (fait && refus == null) ecarts.push({ id: `ecart-${++compteur}`, dossier_id: dossier, piece_id: p.id, retire_le: null })
        }
      } else if (fonction === 'reprendre_piece_ereporting') {
        const x = ecarts.find((y) => y.id === v[1] && y.dossier_id === dossier)
        if (accesRefuse) dire('acces')
        else if (x == null) dire('introuvable')
        else {
          const refus = refusRepriseEcart(x)
          dire('OK', refus)
          if (fait && refus == null) x.retire_le = RETIRE
        }
      } else throw new Error(`Fonction que le test ne sait pas rejouer : ${fonction}`)
    }
  }
  return rejeux
}

// Le module dit-il ce que la base a dit ? L'accès et l'introuvable se jugent à leur code, un refus à son code et à ses mots.
function concorde(r: Rejeu): boolean {
  if (r.cle === 'acces') return r.base.startsWith('42501 ')
  if (r.cle === 'introuvable') return r.base.startsWith('P0002 ')
  if (r.cle === 'OK') return r.base === 'OK'
  return r.base.startsWith('22023 ') && commeLaBase(r.base.slice('22023 '.length), r.message)
}

describe('l’essai joué sur la réplique, rejoué appel par appel', () => {
  const rejeux = rejouer(ESSAI)
  const de = (fonction: string) => rejeux.filter((r) => r.fonction === fonction)

  it('le module dit ce que la base a dit, à chaque appel', () => {
    for (const r of rejeux) expect(concorde(r), `${r.etape.titre} : la base « ${r.base} », le module « ${r.cle} »`).toBe(true)
  })

  it('rejoue tous les appels aux quatre fonctions de l’essai', () => {
    // Compté dans le texte de l'essai, sans le lire comme le rejeu : chaque appel des étapes jouées (le catalogue les nomme
    // sans les appeler).
    const appelsEcrits = (fonction: string) => etapesDe(ESSAI).filter((e) => e.genre === 'fait' || e.genre === 'controle')
      .reduce((n, e) => n + (e.appel.match(new RegExp(`\\b${fonction}\\(`, 'g'))?.length ?? 0), 0)
    for (const fonction of ['confirmer_regime_ereporting', 'retirer_regime_ereporting', 'ecarter_piece_ereporting', 'reprendre_piece_ereporting']) {
      expect(de(fonction), fonction).toHaveLength(appelsEcrits(fonction))
    }
    expect([de('confirmer_regime_ereporting').length, de('retirer_regime_ereporting').length, de('ecarter_piece_ereporting').length,
      de('reprendre_piece_ereporting').length]).toEqual([49, 9, 30, 10])
  })

  it('des acceptés, des accès refusés, des introuvables, sur chaque fonction', () => {
    const compte = (fonction: string, cle: string) => de(fonction).filter((r) => r.cle === cle).length
    expect(['confirmer_regime_ereporting', 'retirer_regime_ereporting', 'ecarter_piece_ereporting', 'reprendre_piece_ereporting']
      .map((f) => [compte(f, 'OK'), compte(f, 'acces'), compte(f, 'introuvable')]))
      .toEqual([[12, 6, 0], [2, 4, 2], [10, 6, 1], [3, 4, 2]])
  })

  it('chaque refus que l’écran peut dire a été rendu au moins une fois par la base', () => {
    const vus = (fonction: string) => new Set(de(fonction).map((r) => r.cle))
    const manquants = (fonction: string, liste: readonly { cle: string }[]) =>
      liste.map((x) => x.cle).filter((cle) => cle !== 'acces' && !cle.endsWith('_introuvable') && !vus(fonction).has(cle))
    expect(manquants('confirmer_regime_ereporting', REFUS_CONFIRMATION_REGIME)).toEqual([])
    expect(manquants('retirer_regime_ereporting', REFUS_RETRAIT_REGIME)).toEqual([])
    expect(manquants('ecarter_piece_ereporting', REFUS_ECART_PIECE)).toEqual([])
    expect(manquants('reprendre_piece_ereporting', REFUS_REPRISE_PIECE)).toEqual([])
  })

  it('un message réécrit dans l’essai, un accepté devenu refus : le rejeu les voit', () => {
    const planter = (avant: string, apres: string) => {
      expect(ESSAI.split(avant)).toHaveLength(2)
      return rejouer(ESSAI.replace(avant, apres)).filter((r) => !concorde(r)).map((r) => r.etape.numero)
    }
    expect(planter("$q$select ecarter_piece_ereporting('{T}', '{P1}', 'Une seconde fois.')$q$,\n      '22023', 'Cette pièce est déjà écartée de l''e-reporting.'],",
      "$q$select ecarter_piece_ereporting('{T}', '{P1}', 'Une seconde fois.')$q$,\n      '22023', 'Cette pièce est écartée.'],")).toEqual(['75'])
    expect(planter("'2026-02-01', 'franchise', null, null, false, 'bimestre', 'bimestre', repeat('n', 2000))$q$, 'OK', ''],",
      "'2026-02-01', 'franchise', null, null, false, 'bimestre', 'bimestre', repeat('n', 2001))$q$, 'OK', ''],")).toEqual(['24b'])
  })
})

// ── Les refus dits avant le clic ────────────────────────────────────────────────────────────────────────────────────

describe('refusConfirmationRegime — dit avant le clic ce que la base refuserait', () => {
  const dit = (s: Partial<SaisieRegime>, regimes: RegimeEreporting[] = []) =>
    refusConfirmationRegime(saisie(s), contexte(regimes))?.cle ?? 'aucun'

  it('accepte un régime juste, et chacun des trois statuts', () => {
    expect(dit({})).toBe('aucun')
    // [M] § 70, [P] § 180 : la franchise tous les deux mois ; [E1], [Q4] : l'exonéré chaque mois.
    expect(dit({ statut_tva: 'franchise', tva_periodicite: null, frequence_transactions: 'bimestre', frequence_paiements: 'bimestre' })).toBe('aucun')
    expect(dit({ statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1', tva_periodicite: null })).toBe('aucun')
    // [M] § 50, [P] § 30 : le réel mensuel par décade ; sur les débits, aucun paiement.
    expect(dit({ tva_periodicite: 'mensuelle', tva_sur_debits: true, frequence_transactions: 'decade', frequence_paiements: null })).toBe('aucun')
  })

  it('le jour : une date qui n’en est pas une ne part pas, et se dit absente', () => {
    expect(argumentsDeLaConfirmation('d1', saisie({ depuis: '2026-02-30' })).p_depuis).toBeNull()
    expect(dit({ depuis: '2026-02-30' })).toBe('depuis_absent')
    expect(dit({ depuis: '01/01/2026' })).toBe('depuis_absent')
    expect(dit({ depuis: null })).toBe('depuis_absent')
    expect(dit({ depuis: '1999-12-31' })).toBe('depuis_avant_2000')
    expect(dit({ depuis: '2000-01-01' })).toBe('aucun')
    expect(refusConfirmationRegime(saisie({ depuis: DEMAIN }), contexte())?.message)
      .toBe("Un régime ne se confirme pas pour l'avenir : nous sommes le 11/10/2026.")
    expect(dit({ depuis: AUJOURD_HUI })).toBe('aucun')
  })

  it('un régime actif du même jour, de ce dossier, se retire d’abord ; un retiré ou celui d’un autre dossier ne compte pas', () => {
    expect(refusConfirmationRegime(saisie(), contexte([regime({ depuis: '2026-01-01' })]))?.message)
      .toBe("Un régime est déjà confirmé à partir du 01/01/2026 : le retirer d'abord pour en confirmer un autre ce jour-là.")
    expect(dit({}, [regime({ depuis: '2026-01-01', retire_le: '2026-03-01T00:00:00Z' })])).toBe('aucun')
    expect(dit({}, [regime({ depuis: '2026-01-01', dossier_id: 'd2' })])).toBe('aucun')
    expect(dit({}, [regime({ depuis: '2026-01-02' })])).toBe('aucun')
  })

  it('le statut, l’article, la périodicité, l’option, dans cet ordre', () => {
    expect(dit({ statut_tva: null })).toBe('statut')
    expect(dit({ statut_tva: 'a_preciser' })).toBe('statut')
    expect(dit({ article_exoneration: 'cgi_262' })).toBe('article_inconnu')
    expect(dit({ statut_tva: 'franchise', article_exoneration: 'cgi_262' })).toBe('article_inconnu')
    expect(dit({ statut_tva: 'franchise', article_exoneration: 'cgi_261_4_1' })).toBe('article_franchise')
    // Un redevable en partie exonéré porte son article.
    expect(dit({ article_exoneration: 'cgi_261_c_2' })).toBe('aucun')
    expect(dit({ tva_periodicite: null })).toBe('periodicite_absente')
    expect(dit({ tva_periodicite: 'annuelle' })).toBe('periodicite_absente')
    expect(dit({ statut_tva: 'exonere', tva_periodicite: 'trimestrielle' })).toBe('periodicite_hors_redevable')
    // Une périodicité inconnue d'un dossier qui n'est pas redevable : la base la refuse comme une connue.
    expect(dit({ statut_tva: 'franchise', tva_periodicite: 'annuelle' })).toBe('periodicite_hors_redevable')
    expect(dit({ tva_sur_debits: null })).toBe('debits_absent')
    expect(dit({ statut_tva: 'franchise', tva_periodicite: null, tva_sur_debits: true })).toBe('debits_hors_redevable')
  })

  it('les fréquences : celles que le régime donne, la décade dite en premier', () => {
    expect(refusConfirmationRegime(saisie({ tva_periodicite: 'mensuelle' }), contexte())?.message)
      .toBe("Sous ce régime, ses ventes et ses achats se déclarent par décade : c'est la fréquence que le cabinet confirme.")
    expect(dit({ frequence_transactions: 'decade', frequence_paiements: null })).toBe('frequence_transactions')
    expect(dit({ tva_sur_debits: true })).toBe('paiements_sur_debits')
    expect(refusConfirmationRegime(saisie({ frequence_paiements: 'bimestre' }), contexte())?.message)
      .toBe("Sous ce régime, ses paiements se déclarent chaque mois : c'est la fréquence que le cabinet confirme.")
    // [Q4] : un exonéré, chaque mois — la décade se refuse.
    expect(dit({ statut_tva: 'exonere', tva_periodicite: null, frequence_transactions: 'decade' })).toBe('frequence_transactions')
    expect(refusConfirmationRegime(saisie({ statut_tva: 'franchise', tva_periodicite: null, frequence_transactions: 'bimestre',
      frequence_paiements: 'mois' }), contexte())?.message)
      .toBe("Sous ce régime, ses paiements se déclarent tous les deux mois : c'est la fréquence que le cabinet confirme.")
  })

  it('la note : des espaces seuls ne sont pas une note, et elle se compte en caractères', () => {
    expect(dit({ note: 'n'.repeat(2000) })).toBe('aucun')
    expect(dit({ note: 'n'.repeat(2001) })).toBe('note_trop_longue')
    // `btrim(x)` ne retire que l'espace : trois mille espaces sont une note vide, une tabulation n'en est pas une.
    expect(dit({ note: ' '.repeat(3000) })).toBe('aucun')
    expect(dit({ note: '\t'.repeat(2001) })).toBe('note_trop_longue')
    // `length` compte des caractères : un signe hors du plan de base (deux unités UTF-16) en vaut un.
    expect(dit({ note: '𝄞'.repeat(2000) })).toBe('aucun')
    expect(dit({ note: '𝄞'.repeat(2001) })).toBe('note_trop_longue')
  })

  it('le retrait : un régime retiré l’est déjà', () => {
    expect(refusRetraitRegime(regime())).toBeNull()
    expect(refusRetraitRegime(regime({ retire_le: '2027-01-03T00:00:00Z' }))).toEqual({ cle: 'deja_retire', message: 'Ce régime est déjà retiré.' })
  })
})

describe('refusEcartPiece — dit avant le clic ce que la base refuserait', () => {
  const dit = (o: { type?: TypePiece; motif?: string | null; fiches?: ReturnType<typeof fiche>[]; ecarts?: PieceEcarteeEreporting[] } = {}) =>
    refusEcartPiece({ id: 'p1', type_piece: o.type ?? 'achat' }, o.motif === undefined ? 'Vérifiée.' : o.motif,
      { fiches: o.fiches ?? [], ecarts: o.ecarts ?? [] })?.cle ?? 'aucun'

  it('accepte un achat ou une note de frais, sans fiche ni écart, avec son motif', () => {
    expect(dit()).toBe('aucun')
    expect(dit({ type: 'note_frais' })).toBe('aucun')
  })

  it('refuse une vente et une autre pièce, avant le motif', () => {
    expect(dit({ type: 'vente' })).toBe('pas_un_achat')
    expect(dit({ type: 'autre', motif: null })).toBe('pas_un_achat')
  })

  it('la fiche courante décide, la chaîne suivie ([E2])', () => {
    expect(dit({ fiches: [fiche()] })).toBe('fiche_courante')
    expect(dit({ fiches: [fiche({ retire_le: '2027-10-05T00:00:00Z' })] })).toBe('fiche_retiree')
    // Retirée puis remplacée : la courante ne l'est pas. Remplacée puis retirée : la courante l'est.
    expect(dit({ fiches: [fiche({ retire_le: '2027-10-05T00:00:00Z' }), fiche({ id: 'f2', remplace_id: 'f1' })] })).toBe('fiche_courante')
    expect(dit({ fiches: [fiche(), fiche({ id: 'f2', remplace_id: 'f1', retire_le: '2027-10-06T00:00:00Z' })] })).toBe('fiche_retiree')
    // Dans l'ordre inverse de la lecture, de même.
    expect(dit({ fiches: [fiche({ id: 'f2', remplace_id: 'f1' }), fiche({ retire_le: '2027-10-05T00:00:00Z' })] })).toBe('fiche_courante')
    // La fiche d'une autre pièce ne compte pas.
    expect(dit({ fiches: [fiche({ piece_id: 'p2' })] })).toBe('aucun')
    // La fiche se dit avant l'écart déjà posé (une fiche posée après l'écart l'emporte).
    expect(dit({ fiches: [fiche()], ecarts: [ecart()] })).toBe('fiche_courante')
  })

  it('un écart actif de la pièce se dit avant le motif ; un retiré ou celui d’une autre pièce ne compte pas', () => {
    expect(dit({ ecarts: [ecart()], motif: null })).toBe('deja_ecartee')
    expect(dit({ ecarts: [ecart({ retire_le: '2027-10-07T00:00:00Z' })] })).toBe('aucun')
    expect(dit({ ecarts: [ecart({ piece_id: 'p2' })] })).toBe('aucun')
  })

  it('le motif : renseigné, des espaces n’en sont pas un, 2 000 caractères au plus', () => {
    expect(dit({ motif: null })).toBe('motif_absent')
    expect(dit({ motif: '   ' })).toBe('motif_absent')
    expect(dit({ motif: '\t' })).toBe('aucun')
    expect(dit({ motif: 'm'.repeat(2000) })).toBe('aucun')
    expect(refusEcartPiece({ id: 'p1', type_piece: 'achat' }, 'm'.repeat(2001), { fiches: [], ecarts: [] })?.message)
      .toBe("Le motif de l'écart dépasse 2 000 caractères.")
  })

  it('la reprise : un écart retiré l’est déjà', () => {
    expect(refusRepriseEcart(ecart())).toBeNull()
    expect(refusRepriseEcart(ecart({ retire_le: '2027-10-07T00:00:00Z' }))?.message)
      .toBe('Cet écart est déjà retiré : la pièce est de nouveau à vérifier.')
  })
})

// ── Les fréquences, la proposition ──────────────────────────────────────────────────────────────────────────────────

describe('les fréquences d’un régime, et le régime proposé', () => {
  it('suivent les textes pour un redevable et un franchisé, et l’hypothèse Q4 pour un exonéré', () => {
    // [M] § 50 et [P] § 170 : le réel mensuel, par décade et chaque mois ; [P] § 30 : rien sur les débits.
    expect(frequencesDuRegime('redevable', 'mensuelle', false)).toEqual({ transactions: 'decade', paiements: 'mois' })
    expect(frequencesDuRegime('redevable', 'mensuelle', true)).toEqual({ transactions: 'decade', paiements: null })
    // [M] § 60 et [P] § 170 : le réel trimestriel, chaque mois.
    expect(frequencesDuRegime('redevable', 'trimestrielle', false)).toEqual({ transactions: 'mois', paiements: 'mois' })
    expect(frequencesDuRegime('redevable', 'trimestrielle', true)).toEqual({ transactions: 'mois', paiements: null })
    // La fonction lit une périodicité absente comme trimestrielle (« else »).
    expect(frequencesDuRegime('redevable', null, false)).toEqual({ transactions: 'mois', paiements: 'mois' })
    // [M] § 70 et [P] § 180 : la franchise, tous les bimestres civils — l'option ne la regarde pas.
    expect(frequencesDuRegime('franchise', null, false)).toEqual({ transactions: 'bimestre', paiements: 'bimestre' })
    expect(frequencesDuRegime('franchise', 'mensuelle', true)).toEqual({ transactions: 'bimestre', paiements: 'bimestre' })
    // [E1] et [Q4] : l'exonéré, chaque mois.
    expect(frequencesDuRegime('exonere', null, false)).toEqual({ transactions: 'mois', paiements: 'mois' })
  })

  it('propose le régime du statut d’aujourd’hui, rien pour un statut à préciser ; le jour, jamais deviné', () => {
    expect(regimeProposeDuDossier(dossier({ statut_tva: null }), '2026-01-01')).toBeNull()
    expect(regimeProposeDuDossier(dossier({ tva_periodicite: 'mensuelle', tva_sur_debits: true }), null)).toEqual({
      depuis: null, statut_tva: 'redevable', article_exoneration: null, tva_periodicite: 'mensuelle', tva_sur_debits: true,
      frequence_transactions: 'decade', frequence_paiements: null, note: null,
    })
    // Un franchisé : ni périodicité ni option, quoi que le dossier en garde.
    expect(regimeProposeDuDossier(dossier({ statut_tva: 'franchise', tva_periodicite: 'mensuelle', tva_sur_debits: true }), '2026-01-01'))
      .toEqual({
        depuis: '2026-01-01', statut_tva: 'franchise', article_exoneration: null, tva_periodicite: null, tva_sur_debits: false,
        frequence_transactions: 'bimestre', frequence_paiements: 'bimestre', note: null,
      })
    // Ce que l'application propose, la fonction l'accepte.
    for (const d of [dossier(), dossier({ tva_periodicite: 'mensuelle' }), dossier({ tva_sur_debits: true }),
      dossier({ statut_tva: 'franchise' }), dossier({ statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1' })]) {
      const propose = regimeProposeDuDossier(d, '2026-01-01')
      expect(propose).not.toBeNull()
      expect(propose && refusConfirmationRegime(propose, contexte())).toBeNull()
    }
  })

  it('dit un régime en une ligne', () => {
    expect(libelleDuRegime(franchise())).toBe('en franchise en base, tous les deux mois')
    expect(libelleDuRegime(regime({ tva_periodicite: 'mensuelle', frequence_transactions: 'decade' }))).toBe('redevable, par décade')
    expect(libelleDuRegime(regime({ article_exoneration: 'cgi_261_c_2' }))).toBe('redevable en partie exonéré, chaque mois')
    expect(libelleDuRegime(regime({ statut_tva: 'exonere', tva_periodicite: null }))).toBe('exonéré, chaque mois')
  })
})

// ── L'histoire des régimes ──────────────────────────────────────────────────────────────────────────────────────────

describe('l’histoire des régimes d’un dossier', () => {
  const histoire = [
    franchise({ id: 'r1', depuis: '2027-01-01' }),
    regime({ id: 'r2', depuis: '2027-10-15' }),
    franchise({ id: 'r0', depuis: '2026-01-01', retire_le: '2026-02-01T00:00:00Z' }),
    regime({ id: 'rx', dossier_id: 'd2', depuis: '2027-05-01' }),
  ]

  it('les actifs du dossier, dans l’ordre de leur jour ; le régime en vigueur un jour donné', () => {
    expect(regimesActifs(histoire, 'd1').map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(regimeEnVigueur(histoire, 'd1', '2026-12-31')).toBeNull()
    expect(regimeEnVigueur(histoire, 'd1', '2027-01-01')?.id).toBe('r1')
    expect(regimeEnVigueur(histoire, 'd1', '2027-10-14')?.id).toBe('r1')
    expect(regimeEnVigueur(histoire, 'd1', '2027-10-15')?.id).toBe('r2')
    expect(regimeEnVigueur(histoire, 'd2', '2027-10-15')?.id).toBe('rx')
  })

  it('deux régimes égaux ne sont pas un changement ; le statut du dossier se compare à son régime', () => {
    expect(memeRegime(franchise({ id: 'a' }), franchise({ id: 'b', depuis: '2028-01-01', note: 'autre' }))).toBe(true)
    expect(memeRegime(regime(), regime({ tva_periodicite: 'mensuelle', frequence_transactions: 'decade' }))).toBe(false)
    expect(memeRegime(regime(), regime({ article_exoneration: 'cgi_261_c_2' }))).toBe(false)
    expect(memeRegime(regime(), regime({ tva_sur_debits: true, frequence_paiements: null }))).toBe(false)
    // La fréquence d'un exonéré est libre dans la table (hypothèse Q4) : deux régimes exonérés qui ne déclarent pas au même
    // rythme ne sont pas le même.
    const exonere = regime({ statut_tva: 'exonere', tva_periodicite: null })
    expect(memeRegime(exonere, { ...exonere, frequence_transactions: 'bimestre' })).toBe(false)
    expect(memeRegime(exonere, { ...exonere, frequence_paiements: 'bimestre' })).toBe(false)
    expect(memeRegime(exonere, { ...exonere, id: 'r9', depuis: '2028-01-01' })).toBe(true)
    expect(regimeEstLeStatutDuDossier(regime(), dossier())).toBe(true)
    expect(regimeEstLeStatutDuDossier(regime(), dossier({ tva_periodicite: 'mensuelle' }))).toBe(false)
    expect(regimeEstLeStatutDuDossier(regime(), dossier({ tva_sur_debits: true }))).toBe(false)
    expect(regimeEstLeStatutDuDossier(regime(), dossier({ statut_tva: 'franchise' }))).toBe(false)
    expect(regimeEstLeStatutDuDossier(regime(), dossier({ article_exoneration: 'cgi_261_c_2' }))).toBe(false)
    // Un franchisé : sa périodicité et son option ne comptent pas.
    expect(regimeEstLeStatutDuDossier(franchise(), dossier({ statut_tva: 'franchise', tva_periodicite: 'mensuelle', tva_sur_debits: true }))).toBe(true)
  })

  it('une période sous son régime confirmé — celui de son premier jour —, même sous un autre statut aujourd’hui', () => {
    // [A] : le régime est une donnée que le dossier a déclarée ; septembre-octobre 2027 en franchise, novembre redevable.
    const aujourdhuiRedevable = dossier()
    expect(regimeDeLaPeriode(histoire, { debut: '2027-09-01', fin: '2027-09-30' }, aujourdhuiRedevable, '2027-12-05'))
      .toEqual({ etat: 'confirme', regime: histoire[0] })
    expect(regimeDeLaPeriode(histoire, { debut: '2027-11-01', fin: '2027-11-30' }, aujourdhuiRedevable, '2027-12-05'))
      .toEqual({ etat: 'confirme', regime: histoire[1] })
  })

  it('une période que rien ne couvre à son premier jour est à confirmer — un régime retiré ne la couvre pas', () => {
    expect(regimeDeLaPeriode(histoire, { debut: '2026-09-01', fin: '2026-10-31' }, dossier(), '2027-12-05')).toEqual({ etat: 'a_confirmer' })
    expect(regimeDeLaPeriode([], { debut: '2027-09-01', fin: '2027-09-30' }, dossier(), '2027-12-05')).toEqual({ etat: 'a_confirmer' })
    // Le régime d'un autre dossier glissé dans la lecture ne couvre rien.
    expect(regimeDeLaPeriode([histoire[3]], { debut: '2027-09-01', fin: '2027-09-30' }, dossier(), '2027-12-05')).toEqual({ etat: 'a_confirmer' })
  })

  it('une période qui couvre un changement de régime est à cheval — le jour du changement, le dernier jour compris', () => {
    const avant = histoire[0]
    const apres = histoire[1]
    expect(regimeDeLaPeriode(histoire, { debut: '2027-09-01', fin: '2027-10-31' }, dossier(), '2027-12-05'))
      .toEqual({ etat: 'a_cheval', avant, apres })
    expect(regimeDeLaPeriode(histoire, { debut: '2027-10-01', fin: '2027-10-15' }, dossier(), '2027-12-05'))
      .toEqual({ etat: 'a_cheval', avant, apres })
    // La veille du changement, la période est sous l'ancien ; commencée le jour même, sous le nouveau.
    expect(regimeDeLaPeriode(histoire, { debut: '2027-10-01', fin: '2027-10-14' }, dossier(), '2027-12-05').etat).toBe('confirme')
    expect(regimeDeLaPeriode(histoire, { debut: '2027-10-15', fin: '2027-10-31' }, dossier(), '2027-12-05'))
      .toEqual({ etat: 'confirme', regime: apres })
    // Un régime ÉGAL qui commence dans la période n'est pas un changement.
    const egal = [franchise({ id: 'r1' }), franchise({ id: 'r3', depuis: '2027-10-15', note: 'reconfirmé' })]
    expect(regimeDeLaPeriode(egal, { debut: '2027-09-01', fin: '2027-10-31' }, dossier({ statut_tva: 'franchise' }), '2027-12-05').etat)
      .toBe('confirme')
    // Deux changements : le premier se dit.
    const deux = [...egal, regime({ id: 'r4', depuis: '2027-10-20' })]
    expect(regimeDeLaPeriode(deux, { debut: '2027-09-01', fin: '2027-10-31' }, dossier(), '2027-12-05'))
      .toEqual({ etat: 'a_cheval', avant: egal[1], apres: deux[2] })
  })

  it('quand le statut du dossier n’est plus le régime en vigueur, toute période qui finit depuis son début est à reconfirmer', () => {
    // Le dossier est passé en franchise dans l'onglet TVA, et rien n'est confirmé : depuis quand ?
    const passeEnFranchise = dossier({ statut_tva: 'franchise' })
    const r2 = histoire[1]
    expect(regimeDeLaPeriode(histoire, { debut: '2027-11-01', fin: '2027-11-30' }, passeEnFranchise, '2028-01-05'))
      .toEqual({ etat: 'a_reconfirmer', regime: r2, enVigueur: r2 })
    // La période qui finit le jour où ce régime a commencé l'est aussi ; celle qui finit la veille, non.
    expect(regimeDeLaPeriode(histoire, { debut: '2027-10-15', fin: '2027-10-15' }, passeEnFranchise, '2028-01-05').etat).toBe('a_reconfirmer')
    expect(regimeDeLaPeriode(histoire, { debut: '2027-09-01', fin: '2027-10-14' }, passeEnFranchise, '2028-01-05'))
      .toEqual({ etat: 'confirme', regime: histoire[0] })
    // Le régime « d'aujourd'hui » est celui du jour où l'on regarde : avant le 15 octobre, c'était la franchise.
    expect(regimeDeLaPeriode(histoire, { debut: '2027-09-01', fin: '2027-09-30' }, passeEnFranchise, '2027-10-10').etat).toBe('confirme')
    // Le jour même où un régime commence, c'est lui qui est en vigueur : un dossier redevable dans l'onglet TVA, le régime
    // redevable confirmé à partir d'aujourd'hui — rien à reconfirmer.
    expect(regimeDeLaPeriode(histoire, { debut: '2027-09-01', fin: '2027-09-30' }, dossier(), '2027-10-15'))
      .toEqual({ etat: 'confirme', regime: histoire[0] })
    expect(regimeDeLaPeriode(histoire, { debut: '2027-09-01', fin: '2027-09-30' }, dossier(), '2027-10-14'))
      .toEqual({ etat: 'a_reconfirmer', regime: histoire[0], enVigueur: histoire[0] })
    // La période se juge sous le régime de SON premier jour, que l'onglet contredit le régime d'aujourd'hui ou non :
    // regardée le 10 octobre (la franchise en vigueur, l'onglet redevable), novembre est sous le régime du 15 octobre.
    expect(regimeDeLaPeriode(histoire, { debut: '2027-11-01', fin: '2027-11-30' }, dossier(), '2027-10-10'))
      .toEqual({ etat: 'a_reconfirmer', regime: r2, enVigueur: histoire[0] })
  })

  it('juge une période sous le statut de son régime ; l’identité du dossier reste celle d’aujourd’hui', () => {
    const d = { ...dossier(), siret: '12345678200010', numero_tva_attribue: true }
    expect(dossierSousLeRegime(d, franchise())).toEqual({
      id: 'd1', siret: '12345678200010', numero_tva_attribue: true, statut_tva: 'franchise', article_exoneration: null,
      tva_periodicite: 'trimestrielle', tva_sur_debits: false,
    })
    expect(dossierSousLeRegime(d, regime({ tva_periodicite: 'mensuelle', tva_sur_debits: true, article_exoneration: 'cgi_261_c_2' })))
      .toMatchObject({ statut_tva: 'redevable', tva_periodicite: 'mensuelle', tva_sur_debits: true, article_exoneration: 'cgi_261_c_2' })
  })
})

describe('les pièces écartées d’un dossier', () => {
  it('l’écart actif d’une pièce, et les pièces écartées du dossier', () => {
    const ecarts = [ecart(), ecart({ id: 'e2', piece_id: 'p2', retire_le: '2027-10-08T00:00:00Z' }), ecart({ id: 'e3', piece_id: 'p2' }),
      ecart({ id: 'e4', piece_id: 'p3', dossier_id: 'd2' })]
    expect(ecartActif(ecarts, 'p2')?.id).toBe('e3')
    expect(ecartActif(ecarts, 'p9')).toBeNull()
    expect([...piecesEcarteesActives(ecarts, 'd1')].sort()).toEqual(['p1', 'p2'])
    expect([...piecesEcarteesActives(ecarts.slice(1, 2), 'd1')]).toEqual([])
  })
})
