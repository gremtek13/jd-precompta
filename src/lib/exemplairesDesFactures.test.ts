import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EXEMPLAIRES_DES_FACTURES_EXPORTES,
  ORDRE_DES_REFUS_DE_LA_GARDE,
  REFUS_DESIGNATION,
  REFUS_GARDE_EXEMPLAIRE,
  REFUS_RETRAIT_DESIGNATION,
  argumentsDeLaDesignation,
  argumentsDuRetraitDeLaDesignation,
  refusDeLaDesignation,
  refusDeLaPieceDesignee,
  refusDuRetraitDeLaDesignation,
  type FacturePourExemplaire,
  type PieceDesignable,
} from './exemplairesDesFactures'
import type { StatutFacture, TypePiece } from './types'
import { appelsDe, commeLaBase, etapesDe, lignesInserees, valeurSql, type Etape } from '../test/essaiSql'
import { argumentsSql, codesSql, messagesSql } from '../test/raiseSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// L'EXEMPLAIRE D'UNE FACTURE ÉMISE (chantier EC-Q3, étape VF1a), confronté à ce qui fait foi. La migration
// `exemplaires_des_factures` attend l'accord du cabinet : tant que l'export (supabase/schema) ne la porte pas, ce que la base
// refuse ne peut pas s'y relire, et la RÉFÉRENCE est l'essai `supabase/essais/exemplairesDesFactures.sql`, joué sur une
// réplique de la production munie de la migration (102 lignes, 0 en faute, dont dix mutations qui mordent) : chacun de ses
// contrôles exige de la base un code ET des mots. Ce test exige que chaque refus du module y soit exigé, et rejoue dans le
// module, appel par appel, ce que l'essai a demandé à la base — sur le même jeu et dans le même ordre : le module doit dire
// ce que la base a dit, le refus au mot près, ou rien quand elle a accepté. Le drapeau levé — la bascule —, il confronte
// aussi le module au texte même des deux fonctions et de la garde. CHAQUE AUTRE ATTENDU EST ÉCRIT À LA MAIN, depuis la
// migration (son en-tête dit l'ordre des refus) et la conception (HISTORIQUE.md, « LA FACTURE VALIDÉE, SOURCE DE SA
// VENTE : LA CONCEPTION », § 8 et § 14).

const ESSAI = readFileSync(new URL('../../supabase/essais/exemplairesDesFactures.sql', import.meta.url), 'utf8')

const modeles = (liste: readonly { modele: string }[]) => liste.map((r) => r.modele)

// Un modèle du module, en expression régulière : chaque « % » une valeur.
function modeleEnRegex(modele: string): RegExp {
  return new RegExp(`^${modele.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`)
}

const FONCTIONS = ['designer_exemplaire_facture', 'defaire_exemplaire_facture'] as const
type Fonction = (typeof FONCTIONS)[number]
const appelle = (e: Etape, f: Fonction) => new RegExp(`\\b${f}\\(`).test(e.appel)

// ── 1. L'essai, lu ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('l’essai, lu', () => {
  const etapes = etapesDe(ESSAI)

  it('ses étapes, toutes : le plancher qui distingue « aucun écart » d’« aveugle »', () => {
    // Le compte des étapes que le fichier OUVRE (« array[' » suivi d'un genre) est celui des étapes que le motif reconnaît
    // en entier : un motif qui ne les reconnaîtrait plus rendrait une liste vide, et tout ce qui suit passerait sans rien
    // confronter.
    const ouvertes = [...ESSAI.matchAll(/^\s*array\['(?:jeu|controle|fait|valeur|retenir|lecture)'/gm)].length
    expect(etapes).toHaveLength(ouvertes)
    const parGenre = (g: string) => etapes.filter((e) => e.genre === g).length
    expect([parGenre('jeu'), parGenre('fait'), parGenre('controle'), parGenre('lecture'), parGenre('valeur'), parGenre('retenir')])
      .toEqual([2, 3, 72, 16, 9, 0])
    expect(etapes.filter((e) => /^\d+\. MUTATION — /.test(e.titre))).toHaveLength(10)
    // Chaque contrôle a son numéro, une seule fois ; les étapes « 0. le jeu » posent le jeu.
    const numerotees = etapes.filter((e) => e.numero !== '' && e.numero !== '0')
    expect(new Set(numerotees.map((e) => e.numero)).size).toBe(numerotees.length)
    expect(numerotees).toHaveLength(97)
  })

  it('un modèle du module se lit comme remplirModele l’écrit : chaque « % » une valeur, jamais rien', () => {
    expect(modeleEnRegex(REFUS_DESIGNATION[3].modele).test(
      "Cette pièce porte une écriture validée de l'exercice 2026 : sa désignation ne change plus.")).toBe(true)
    expect(modeleEnRegex(REFUS_DESIGNATION[3].modele).test(
      "Cette pièce porte une écriture validée de l'exercice  : sa désignation ne change plus.")).toBe(false)
    expect(modeleEnRegex(REFUS_DESIGNATION[1].modele).test('Pièce introuvable dans ce dossier')).toBe(false)
  })
})

// ── 2. Chaque refus du module, exigé de la base par l'essai — et l'inverse ────────────────────────────────────────────

describe('les refus du module sont ceux que l’essai exige de la base', () => {
  const etapes = etapesDe(ESSAI).filter((e) => e.genre === 'controle' && e.code !== 'OK')
  // Une étape de plusieurs instructions (un appel, puis une écriture directe) exige le refus de sa DERNIÈRE instruction :
  // elle ne dit rien de la fonction qu'elle appelle d'abord.
  const exiges = (f: Fonction) => etapes.filter((e) => appelle(e, f) && !e.appel.includes(';'))
    .map((e) => ({ code: e.code, message: e.attendu }))

  it('désigner : chaque refus du module est exigé, sous son code ; chaque refus exigé est un refus du module ou le droit d’exécution', () => {
    for (const r of REFUS_DESIGNATION) {
      expect(exiges('designer_exemplaire_facture').some((x) => x.code === r.code && modeleEnRegex(r.modele).test(x.message)), r.cle)
        .toBe(true)
    }
    for (const x of exiges('designer_exemplaire_facture')) {
      const connu = REFUS_DESIGNATION.some((r) => r.code === x.code && modeleEnRegex(r.modele).test(x.message))
        || (x.code === '42501' && x.message === 'permission denied for function designer_exemplaire_facture')
      expect(connu, x.message).toBe(true)
    }
  })

  it('défaire : de même', () => {
    for (const r of REFUS_RETRAIT_DESIGNATION) {
      expect(exiges('defaire_exemplaire_facture').some((x) => x.code === r.code && modeleEnRegex(r.modele).test(x.message)), r.cle)
        .toBe(true)
    }
    for (const x of exiges('defaire_exemplaire_facture')) {
      const connu = REFUS_RETRAIT_DESIGNATION.some((r) => r.code === x.code && modeleEnRegex(r.modele).test(x.message))
        || (x.code === '42501' && x.message === 'permission denied for function defaire_exemplaire_facture')
      expect(connu, x.message).toBe(true)
    }
  })

  it('la garde : chaque refus est exigé d’une écriture directe, sous son code', () => {
    const directs = etapes.filter((e) => !FONCTIONS.some((f) => appelle(e, f)) && /\b(update|insert into) pieces\b/.test(e.appel)
      && !e.appel.includes(';'))
    for (const r of REFUS_GARDE_EXEMPLAIRE) {
      expect(directs.some((e) => e.code === r.code && modeleEnRegex(r.modele).test(e.attendu)), r.cle).toBe(true)
    }
  })

  it('les deux fonctions partagent les mots d’un même refus — l’accès, la pièce introuvable, le gel —, et la garde ceux de la nature', () => {
    for (const cle of ['acces', 'piece_introuvable', 'piece_figee'] as const) {
      expect(REFUS_RETRAIT_DESIGNATION.find((r) => r.cle === cle)?.modele, cle).toBe(REFUS_DESIGNATION.find((r) => r.cle === cle)?.modele)
    }
    expect(REFUS_GARDE_EXEMPLAIRE.find((r) => r.cle === 'pas_une_vente')?.modele)
      .toBe(REFUS_DESIGNATION.find((r) => r.cle === 'pas_une_vente')?.modele)
  })
})

// ── 3. L'essai rejoué appel par appel ─────────────────────────────────────────────────────────────────────────────────

interface Rejeu {
  etape: Etape
  quoi: string
  /** Ce que la base a rendu : « OK », ou le code et le message. */
  base: string
  /** Ce que le module en dit : la clé de son refus, « OK », ou « acces » quand l'appelant n'a pas accès. */
  cle: string
  message: string | null
  /** Le code du refus, tiré de la liste de la fonction qui le lèverait (un même mot vit dans deux listes, sous deux codes). */
  code: string | null
}

type ListeDeRefus = readonly { readonly cle: string; readonly code: string }[]

const TYPES: readonly TypePiece[] = ['achat', 'vente', 'note_frais', 'autre']
const STATUTS: readonly StatutFacture[] = ['brouillon', 'validee']

/**
 * L'essai rejoué : ce qu'il a construit en base au moment de chaque étape — ses dossiers, ses factures (posées par une
 * étape `fait`), ses pièces, les écritures validées qui en figent trois, les désignations que ses étapes `fait` posent (un
 * `controle` s'annule) — et, pour chaque appel aux deux fonctions et chaque écriture directe d'une pièce, ce que le module
 * en dit. Les profils et leurs accès sont ceux du moteur de l'essai : le chef (super-administrateur) et le chef simple
 * partout dans le cabinet, le membre dans T seul, le membre d'ailleurs dans A seul ; le client — avec ou sans accès à T,
 * avec ou sans cases —, le compte rattaché à rien et l'anonyme, nulle part ; un dossier qui n'existe pas, pour personne.
 */
function rejouer(essai: string): Rejeu[] {
  const noms = new Map<string, string>()
  for (const m of essai.matchAll(/\{(\w+)\}/g)) if (!noms.has(m[1])) noms.set(m[1], m[1])
  const dossiers = new Set<string>()
  const factures: FacturePourExemplaire[] = []
  const pieces = new Map<string, PieceDesignable>()
  const figees = new Map<string, number>()
  const rejeux: Rejeu[] = []

  for (const e of etapesDe(essai)) {
    if (e.genre === 'jeu' || e.genre === 'fait') {
      for (const d of lignesInserees(e.appel, 'dossiers', noms)) dossiers.add(String(d.id))
      for (const f of lignesInserees(e.appel, 'factures_emises', noms)) {
        const statut = STATUTS.find((s) => s === f.statut)
        if (statut == null) throw new Error(`Statut de facture inconnu : ${String(f.statut)}`)
        factures.push({ id: String(f.id), dossier_id: String(f.dossier_id), statut, numero: f.numero == null ? null : String(f.numero) })
      }
      for (const p of lignesInserees(e.appel, 'pieces', noms)) {
        const type = TYPES.find((t) => t === p.type_piece)
        if (type == null) throw new Error(`Type de pièce inconnu : ${String(p.type_piece)}`)
        pieces.set(String(p.id), { id: String(p.id), dossier_id: String(p.dossier_id), type_piece: type, facture_id: null })
      }
      for (const x of lignesInserees(e.appel, 'ecritures_brouillon', noms)) {
        if (x.statut !== 'validee' || x.piece_id == null) continue
        const annee = Number(String(x.date).slice(0, 4))
        const avant = figees.get(String(x.piece_id))
        figees.set(String(x.piece_id), avant === undefined ? annee : Math.min(avant, annee))
      }
    }
    if (e.genre !== 'fait' && e.genre !== 'controle') continue
    const fait = e.genre === 'fait'
    if (fait) expect(e.code, e.titre).toBe('OK')
    const base = e.code === 'OK' ? 'OK' : `${e.code} ${e.attendu}`
    const dire = (quoi: string, liste: ListeDeRefus, cle: string, refus: { cle: string; message: string } | null = null) => {
      const retenue = refus?.cle ?? cle
      const code = retenue === 'OK' ? null : liste.find((x) => x.cle === retenue)?.code
      if (code === undefined) throw new Error(`Refus sans code dans sa liste : ${retenue}`)
      rejeux.push({ etape: e, quoi, base, cle: retenue, message: refus?.message ?? null, code })
    }

    // Plusieurs instructions (un appel, puis une écriture directe ; un réglage, puis une écriture) : l'essai les juge seul.
    if (e.appel.includes(';')) continue

    // Une écriture directe d'une pièce, d'une seule instruction : la garde, que le module redit pour l'écran.
    const directe = /^update pieces set (.+) where id = '\{(\w+)\}'$/.exec(e.appel)
    if (directe) {
      const affectations = new Map(directe[1].split(', ').map((a) => {
        const m = /^(\w+) = (.+)$/.exec(a)
        if (!m) throw new Error(`Affectation que le test ne sait pas lire : ${a}`)
        return [m[1], m[2]] as const
      }))
      const piece = pieces.get(directe[2])
      if (piece == null) throw new Error(`Pièce inconnue : ${directe[2]}`)
      const facture = affectations.get('facture_id')
      // Hors des fonctions, la désignation ne s'écrit pas — pour personne ; réécrite à elle-même, elle ne change pas.
      if (facture !== undefined && facture !== 'facture_id') {
        dire('écriture directe de la désignation', REFUS_GARDE_EXEMPLAIRE, 'hors_des_fonctions', {
          cle: 'hors_des_fonctions', message: REFUS_GARDE_EXEMPLAIRE[0].modele,
        })
        continue
      }
      const lire = (colonne: string) => {
        const v = affectations.get(colonne)
        return v === undefined || v === colonne ? undefined : String(valeurSql(v, noms))
      }
      const changement = { dossier_id: lire('dossier_id'), type_piece: TYPES.find((t) => t === lire('type_piece')) }
      if (lire('type_piece') !== undefined && changement.type_piece === undefined) throw new Error(`Type inconnu : ${e.appel}`)
      dire('écriture directe de la pièce', REFUS_GARDE_EXEMPLAIRE, 'OK', refusDeLaPieceDesignee(piece, changement, factures))
      continue
    }

    const appels = appelsDe(e.appel)
    // Une insertion directe d'une pièce : la garde à l'insertion et la restauration, que l'essai juge seul (l'écran n'insère
    // jamais une pièce désignée).
    if (appels == null) continue
    for (const { fonction, arguments: brut } of appels) {
      if (!FONCTIONS.some((f) => f === fonction)) throw new Error(`Fonction que le test ne sait pas rejouer : ${fonction}`)
      const v = brut.map((x) => valeurSql(x, noms))
      const dossier = String(v[0])
      const accesRefuse = ['anon', 'inconnu', 'client', 'client_t', 'client_t_ventes'].includes(e.profil) || !dossiers.has(dossier)
        || (e.profil === 'membre' && dossier !== 'T') || (e.profil === 'membre_ailleurs' && dossier !== 'A')
      const liste = fonction === 'designer_exemplaire_facture' ? REFUS_DESIGNATION : REFUS_RETRAIT_DESIGNATION
      if (accesRefuse) {
        dire(fonction, liste, 'acces')
        continue
      }
      const piece = v[1] == null ? null : pieces.get(String(v[1])) ?? null
      const anneeFigeante = piece == null ? null : figees.get(piece.id) ?? null
      if (fonction === 'designer_exemplaire_facture') {
        const factureId = v[2] == null ? null : String(v[2])
        const refus = refusDeLaDesignation(piece, factureId, { dossierId: dossier, anneeFigeante, factures })
        dire(fonction, liste, 'OK', refus)
        if (fait && refus == null && piece != null) piece.facture_id = factureId
      } else {
        const refus = refusDuRetraitDeLaDesignation(piece, { dossierId: dossier, anneeFigeante })
        dire(fonction, liste, 'OK', refus)
        if (fait && refus == null && piece != null) piece.facture_id = null
      }
    }
  }
  return rejeux
}

// Le module dit-il ce que la base a dit ? L'accès se juge à son code ; un refus, à son code et à ses mots.
function concorde(r: Rejeu): boolean {
  if (r.cle === 'acces') return r.base.startsWith('42501 ')
  if (r.cle === 'OK') return r.base === 'OK'
  return r.code !== null && r.base.startsWith(`${r.code} `) && commeLaBase(r.base.slice(r.code.length + 1), r.message)
}

describe('l’essai joué sur la réplique, rejoué appel par appel', () => {
  const rejeux = rejouer(ESSAI)
  const de = (quoi: string) => rejeux.filter((r) => r.quoi === quoi)

  it('le module dit ce que la base a dit, à chaque appel et à chaque écriture directe d’une pièce', () => {
    for (const r of rejeux) expect(concorde(r), `${r.etape.titre} : la base « ${r.base} », le module « ${r.cle} » ${r.message ?? ''}`).toBe(true)
  })

  it('rejoue tous les appels aux deux fonctions des étapes d’une seule instruction, et les écritures directes', () => {
    // Compté dans le texte de l'essai, sans le lire comme le rejeu : chaque appel des étapes jouées d'une seule instruction
    // (une étape de plusieurs instructions, que l'essai juge seul, se reconnaît à son point-virgule).
    const appelsEcrits = (fonction: Fonction) => etapesDe(ESSAI)
      .filter((e) => (e.genre === 'fait' || e.genre === 'controle') && !e.appel.includes(';'))
      .reduce((n, e) => n + (e.appel.match(new RegExp(`\\b${fonction}\\(`, 'g'))?.length ?? 0), 0)
    for (const f of FONCTIONS) expect(de(f), f).toHaveLength(appelsEcrits(f))
    expect([de('designer_exemplaire_facture').length, de('defaire_exemplaire_facture').length,
      de('écriture directe de la désignation').length, de('écriture directe de la pièce').length]).toEqual([35, 14, 6, 4])
  })

  it('des acceptés et des accès refusés, sur chaque fonction ; des refus et des acceptés de la garde', () => {
    const compte = (quoi: string, cle: string) => de(quoi).filter((r) => r.cle === cle).length
    expect([compte('designer_exemplaire_facture', 'OK'), compte('designer_exemplaire_facture', 'acces')]).toEqual([11, 7])
    expect([compte('defaire_exemplaire_facture', 'OK'), compte('defaire_exemplaire_facture', 'acces')]).toEqual([3, 7])
    expect([compte('écriture directe de la pièce', 'OK'), compte('écriture directe de la pièce', 'change_de_dossier'),
      compte('écriture directe de la pièce', 'change_de_nature')]).toEqual([2, 1, 1])
  })

  it('chaque refus que l’écran peut dire a été rendu au moins une fois par la base', () => {
    const vus = (quoi: string) => new Set(de(quoi).map((r) => r.cle))
    const manquants = (quoi: string, liste: readonly { cle: string }[]) =>
      liste.map((x) => x.cle).filter((cle) => cle !== 'acces' && !vus(quoi).has(cle))
    expect(manquants('designer_exemplaire_facture', REFUS_DESIGNATION)).toEqual([])
    expect(manquants('defaire_exemplaire_facture', REFUS_RETRAIT_DESIGNATION)).toEqual([])
    expect(manquants('écriture directe de la pièce', REFUS_GARDE_EXEMPLAIRE.filter((r) => r.cle.startsWith('change_')))).toEqual([])
  })

  it('un message réécrit dans l’essai, un accepté devenu refus, un refus devenu accepté : le rejeu les voit', () => {
    const planter = (avant: string, apres: string) => {
      expect(ESSAI.split(avant), avant).toHaveLength(2)
      return rejouer(ESSAI.replace(avant, apres)).filter((r) => !concorde(r)).map((r) => r.etape.numero)
    }
    expect(planter("'22023', 'Cette pièce est déjà l''exemplaire de la facture F2026-0002.'],",
      "'22023', 'Cette pièce est déjà l''exemplaire de la facture F2026-0001.'],")).toEqual(['17'])
    expect(planter("$q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],\n    array['controle', '9.",
      "$q$select designer_exemplaire_facture('{T}', '{PV1}', '{FB}')$q$, 'OK', ''],\n    array['controle', '9.")).toEqual(['8'])
    expect(planter("$q$select defaire_exemplaire_facture('{T}', '{PFIG2}')$q$,",
      "$q$select defaire_exemplaire_facture('{T}', '{PV4}')$q$,")).toEqual(['49'])
    expect(planter("$q$update pieces set type_piece = 'achat' where id = '{PV4}'$q$,",
      "$q$update pieces set type_piece = 'vente' where id = '{PV4}'$q$,")).toEqual(['77'])
    // Le jeu : une désignation de moins, et la pièce qu'elle portait n'est plus « déjà l'exemplaire » de rien.
    expect(planter("designer_exemplaire_facture('{T}', '{PV4}', '{F2}'), designer_exemplaire_facture('{T}', '{PV5}', '{F1}')",
      "designer_exemplaire_facture('{T}', '{PV5}', '{F1}')")).toEqual(['17', '18', '26', '76', '77', '148'])
  })
})

// ── 4. Les refus dits avant le clic, cas par cas ──────────────────────────────────────────────────────────────────────

const D = 'd1'
function piece(o: Partial<PieceDesignable> = {}): PieceDesignable {
  return { id: 'p1', dossier_id: D, type_piece: 'vente', facture_id: null, ...o }
}
function facture(o: Partial<FacturePourExemplaire> = {}): FacturePourExemplaire {
  return { id: 'f1', dossier_id: D, statut: 'validee', numero: 'F2026-0007', ...o }
}
const FACTURES = [facture(), facture({ id: 'f2', numero: 'F2026-0008' }), facture({ id: 'av', numero: 'A2026-0001' }),
  facture({ id: 'fb', statut: 'brouillon', numero: null }), facture({ id: 'fa', dossier_id: 'd2', numero: 'F2026-0001' })]
const contexte = (o: Partial<{ anneeFigeante: number | null }> = {}) => ({ dossierId: D, anneeFigeante: null, factures: FACTURES, ...o })
const cle = (r: { cle: string } | null) => r?.cle ?? 'aucun'

describe('refusDeLaDesignation — dit avant le clic ce que designer_exemplaire_facture refuserait', () => {
  it('une pièce de vente du dossier, que rien ne fige ni ne désigne, et une facture validée du dossier — un avoir compris', () => {
    expect(refusDeLaDesignation(piece(), 'f1', contexte())).toBeNull()
    expect(refusDeLaDesignation(piece(), 'av', contexte())).toBeNull()
    // Une pièce dont la désignation n'a pas été lue (la colonne absente) n'en porte aucune.
    expect(refusDeLaDesignation({ id: 'p1', dossier_id: D, type_piece: 'vente' }, 'f1', contexte())).toBeNull()
  })

  it('2. la pièce : aucune, ou d’un autre dossier', () => {
    expect(refusDeLaDesignation(null, 'f1', contexte())).toEqual({ cle: 'piece_introuvable', message: 'Pièce introuvable dans ce dossier.' })
    expect(cle(refusDeLaDesignation(piece({ dossier_id: 'd2' }), 'f1', contexte()))).toBe('piece_introuvable')
  })

  it('3. une pièce de vente seulement', () => {
    for (const type_piece of ['achat', 'note_frais', 'autre'] as const) {
      expect(refusDeLaDesignation(piece({ type_piece }), 'f1', contexte()), type_piece)
        .toEqual({ cle: 'pas_une_vente', message: "Seule une pièce de vente est l'exemplaire d'une facture émise." })
    }
  })

  it('4. une pièce figée : l’exercice qui la fige est dit', () => {
    expect(refusDeLaDesignation(piece(), 'f1', contexte({ anneeFigeante: 2025 }))).toEqual({
      cle: 'piece_figee', message: "Cette pièce porte une écriture validée de l'exercice 2025 : sa désignation ne change plus.",
    })
  })

  it('5. une pièce déjà désignée : à cette facture, ou à une autre — le numéro est celui de la facture qu’elle désigne', () => {
    expect(refusDeLaDesignation(piece({ facture_id: 'f2' }), 'f2', contexte())).toEqual({
      cle: 'deja_cette_facture', message: "Cette pièce est déjà l'exemplaire de la facture F2026-0008.",
    })
    expect(refusDeLaDesignation(piece({ facture_id: 'f2' }), 'f1', contexte())).toEqual({
      cle: 'deja_une_autre',
      message: "Cette pièce est déjà l'exemplaire de la facture F2026-0008 : défaire cette désignation avant d'en faire une autre.",
    })
    // Aucune facture choisie : une autre que celle qu'elle désigne, comme la base le compare (nul n'égale rien).
    expect(cle(refusDeLaDesignation(piece({ facture_id: 'f2' }), null, contexte()))).toBe('deja_une_autre')
    // La facture qu'elle désigne absente de la lecture : la base dirait son numéro ; le module ne l'invente pas.
    expect(refusDeLaDesignation(piece({ facture_id: 'fx' }), 'f1', contexte())?.message)
      .toBe("Cette pièce est déjà l'exemplaire de la facture (sans numéro) : défaire cette désignation avant d'en faire une autre.")
  })

  it('6. la facture : aucune, absente, ou d’un autre dossier ; 7. un brouillon', () => {
    expect(refusDeLaDesignation(piece(), null, contexte())).toEqual({ cle: 'facture_introuvable', message: 'Facture introuvable dans ce dossier.' })
    expect(cle(refusDeLaDesignation(piece(), 'fx', contexte()))).toBe('facture_introuvable')
    expect(cle(refusDeLaDesignation(piece(), 'fa', contexte()))).toBe('facture_introuvable')
    expect(refusDeLaDesignation(piece(), 'fb', contexte())).toEqual({
      cle: 'facture_brouillon', message: "Seule une facture validée a un exemplaire : un brouillon n'est pas encore une facture émise.",
    })
  })

  it('deux refus ensemble : le premier dans l’ordre de la fonction', () => {
    // La pièce avant la facture, la nature avant le gel, le gel avant la désignation, la désignation avant la facture.
    expect(cle(refusDeLaDesignation(piece({ dossier_id: 'd2' }), 'fb', contexte()))).toBe('piece_introuvable')
    expect(cle(refusDeLaDesignation(piece({ type_piece: 'achat' }), 'fb', contexte({ anneeFigeante: 2026 })))).toBe('pas_une_vente')
    expect(cle(refusDeLaDesignation(piece({ facture_id: 'f1' }), 'f2', contexte({ anneeFigeante: 2026 })))).toBe('piece_figee')
    expect(cle(refusDeLaDesignation(piece({ facture_id: 'f1' }), 'fa', contexte()))).toBe('deja_une_autre')
    expect(cle(refusDeLaDesignation(piece({ facture_id: 'f1' }), 'fb', contexte()))).toBe('deja_une_autre')
  })
})

describe('refusDuRetraitDeLaDesignation — dit avant le clic ce que defaire_exemplaire_facture refuserait', () => {
  it('une pièce désignée que rien ne fige se défait', () => {
    expect(refusDuRetraitDeLaDesignation(piece({ facture_id: 'f1' }), contexte())).toBeNull()
  })

  it('2. la pièce ; 3. une pièce que rien ne désigne — la colonne absente comprise ; 4. le gel', () => {
    expect(cle(refusDuRetraitDeLaDesignation(null, contexte()))).toBe('piece_introuvable')
    expect(cle(refusDuRetraitDeLaDesignation(piece({ dossier_id: 'd2', facture_id: 'f1' }), contexte()))).toBe('piece_introuvable')
    expect(refusDuRetraitDeLaDesignation(piece(), contexte()))
      .toEqual({ cle: 'pas_designee', message: "Cette pièce n'est l'exemplaire d'aucune facture." })
    expect(cle(refusDuRetraitDeLaDesignation({ id: 'p1', dossier_id: D, type_piece: 'vente' }, contexte()))).toBe('pas_designee')
    expect(refusDuRetraitDeLaDesignation(piece({ facture_id: 'f1' }), contexte({ anneeFigeante: 2024 }))).toEqual({
      cle: 'piece_figee', message: "Cette pièce porte une écriture validée de l'exercice 2024 : sa désignation ne change plus.",
    })
  })

  it('une pièce figée que rien ne désigne : la désignation avant le gel', () => {
    expect(cle(refusDuRetraitDeLaDesignation(piece(), contexte({ anneeFigeante: 2024 })))).toBe('pas_designee')
  })
})

describe('refusDeLaPieceDesignee — ce que la garde refuse d’une pièce désignée qu’on modifie', () => {
  it('une pièce que rien ne désigne change librement', () => {
    expect(refusDeLaPieceDesignee(piece(), { dossier_id: 'd2', type_piece: 'achat' }, FACTURES)).toBeNull()
    expect(refusDeLaPieceDesignee({ id: 'p1', dossier_id: D, type_piece: 'vente' }, { dossier_id: 'd2' }, FACTURES)).toBeNull()
  })

  it('une pièce désignée ne change pas de dossier, et reste une vente ; le dossier se dit d’abord', () => {
    const p = piece({ facture_id: 'f2' })
    expect(refusDeLaPieceDesignee(p, { dossier_id: 'd2' }, FACTURES)).toEqual({
      cle: 'change_de_dossier',
      message: "Cette pièce est l'exemplaire de la facture F2026-0008 : elle ne change plus de dossier — défaire d'abord la désignation.",
    })
    expect(refusDeLaPieceDesignee(p, { type_piece: 'achat' }, FACTURES)).toEqual({
      cle: 'change_de_nature',
      message: "Cette pièce est l'exemplaire de la facture F2026-0008 : elle reste une pièce de vente — défaire d'abord la désignation.",
    })
    expect(cle(refusDeLaPieceDesignee(p, { dossier_id: 'd2', type_piece: 'achat' }, FACTURES))).toBe('change_de_dossier')
  })

  it('le reste d’une pièce désignée se modifie : son dossier et sa nature réécrits à l’identique compris', () => {
    const p = piece({ facture_id: 'f2' })
    expect(refusDeLaPieceDesignee(p, {}, FACTURES)).toBeNull()
    expect(refusDeLaPieceDesignee(p, { dossier_id: D, type_piece: 'vente' }, FACTURES)).toBeNull()
  })
})

// ── 5. Le drapeau, et le texte de la migration exportée ───────────────────────────────────────────────────────────────

describe('le drapeau, et le module confronté au texte exporté', () => {
  const exportee = fichiersDuSchema().some((f) => /create function public\.designer_exemplaire_facture\(/.test(f.texte))
  const texteDeLaMigration = () => fichiersDuSchema().find((f) => /create function public\.designer_exemplaire_facture\(/.test(f.texte))?.texte as string

  it('le drapeau dit ce que porte l’export : faux tant que la migration n’y est pas', () => {
    expect(EXEMPLAIRES_DES_FACTURES_EXPORTES, 'EXEMPLAIRES_DES_FACTURES_EXPORTES ne dit plus ce que porte l’export').toBe(exportee)
  })

  it('exportée : désigner — les mêmes messages, dans le même ordre, sous les mêmes codes, aux mêmes valeurs', () => {
    if (!EXEMPLAIRES_DES_FACTURES_EXPORTES) return
    const sql = derniereDefinitionSql('designer_exemplaire_facture')
    expect(messagesSql(sql)).toEqual(modeles(REFUS_DESIGNATION))
    expect(codesSql(sql)).toEqual(REFUS_DESIGNATION.map((r) => r.code))
    expect(argumentsSql(sql)).toEqual([[], [], [], ['v_annee'], ['v_numero'], ['v_numero'], [], []])
    expect(sql).toMatch(/designer_exemplaire_facture\(p_dossier_id uuid, p_piece_id uuid, p_facture_id uuid\)\nreturns public\.pieces\nlanguage plpgsql\nsecurity definer\nset search_path = public/)
    // L'accès d'abord, puis le verrou partagé de la validation, avant toute lecture de la pièce.
    const corps = sql.slice(sql.indexOf('\nbegin\n'))
    const acces = corps.indexOf("raise exception 'Accès refusé à ce dossier.'")
    expect(acces).toBeGreaterThan(0)
    expect(corps.slice(0, acces)).not.toMatch(/from public\.pieces/)
    expect(corps.indexOf('pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id))')).toBeGreaterThan(acces)
    expect(corps.indexOf('from public.pieces p')).toBeGreaterThan(corps.indexOf('pg_advisory_xact_lock_shared'))
    expect(sql).toContain("v_annee := public.exercice_figeant_la_piece(p_piece_id);")
  })

  it('exportée : défaire — de même', () => {
    if (!EXEMPLAIRES_DES_FACTURES_EXPORTES) return
    const sql = derniereDefinitionSql('defaire_exemplaire_facture')
    expect(messagesSql(sql)).toEqual(modeles(REFUS_RETRAIT_DESIGNATION))
    expect(codesSql(sql)).toEqual(REFUS_RETRAIT_DESIGNATION.map((r) => r.code))
    expect(argumentsSql(sql)).toEqual([[], [], [], ['v_annee']])
    expect(sql).toMatch(/defaire_exemplaire_facture\(p_dossier_id uuid, p_piece_id uuid\)\nreturns public\.pieces\nlanguage plpgsql\nsecurity definer\nset search_path = public/)
  })

  it('exportée : la garde — ses refus dans l’ordre de son texte, aux droits de l’appelant', () => {
    if (!EXEMPLAIRES_DES_FACTURES_EXPORTES) return
    const sql = derniereDefinitionSql('garder_exemplaire_facture')
    const parCle = (c: string) => REFUS_GARDE_EXEMPLAIRE.find((r) => r.cle === c) as (typeof REFUS_GARDE_EXEMPLAIRE)[number]
    expect(messagesSql(sql)).toEqual(ORDRE_DES_REFUS_DE_LA_GARDE.map((c) => parCle(c).modele))
    expect(codesSql(sql)).toEqual(ORDRE_DES_REFUS_DE_LA_GARDE.map((c) => parCle(c).code))
    expect(sql).toMatch(/garder_exemplaire_facture\(\) returns trigger\nlanguage plpgsql\nset search_path = public\nas/)
    // Le réglage que les deux fonctions annoncent est celui que la garde lit, pour la pièce même.
    expect(sql).toContain("coalesce(current_setting('jd.exemplaire_facture', true), '') is distinct from old.id::text")
    for (const f of ['designer_exemplaire_facture', 'defaire_exemplaire_facture']) {
      const corps = derniereDefinitionSql(f)
      expect(corps, f).toContain("perform set_config('jd.exemplaire_facture', p_piece_id::text, true);")
      expect(corps, f).toContain("perform set_config('jd.exemplaire_facture', '', true);")
    }
  })

  it('exportée : la colonne, sa clé sans action, l’index, le déclencheur et les droits d’exécution', () => {
    if (!EXEMPLAIRES_DES_FACTURES_EXPORTES) return
    const texte = texteDeLaMigration()
    expect(texte).toContain('alter table public.pieces add column facture_id uuid references public.factures_emises (id);')
    expect(texte).toContain('create index pieces_facture_idx on public.pieces (facture_id) where facture_id is not null;')
    expect(texte).toContain('create trigger pieces_exemplaire_de_facture\n  before insert or update of facture_id, dossier_id, type_piece on public.pieces\n  for each row execute function public.garder_exemplaire_facture();')
    expect(texte).toContain('revoke execute on function public.designer_exemplaire_facture(uuid, uuid, uuid) from public, anon;')
    expect(texte).toContain('grant execute on function public.designer_exemplaire_facture(uuid, uuid, uuid) to authenticated;')
    expect(texte).toContain('revoke execute on function public.defaire_exemplaire_facture(uuid, uuid) from public, anon;')
    expect(texte).toContain('grant execute on function public.defaire_exemplaire_facture(uuid, uuid) to authenticated;')
    expect(texte).toContain('revoke execute on function public.garder_exemplaire_facture() from public, anon, authenticated;')
    // Aucune policy : la migration n'en crée ni n'en change.
    expect(texte).not.toMatch(/\b(create|alter) policy\b/i)
  })

  it('exportée : les paramètres, dans l’ordre des signatures', () => {
    if (!EXEMPLAIRES_DES_FACTURES_EXPORTES) return
    const parametresDe = (nom: string) => (/function public\.\w+\(([^)]*)\)/.exec(derniereDefinitionSql(nom))?.[1] ?? '')
      .split(',').map((p) => p.trim().split(/\s+/)[0])
    expect(Object.keys(argumentsDeLaDesignation('d', 'p', 'f'))).toEqual(parametresDe('designer_exemplaire_facture'))
    expect(Object.keys(argumentsDuRetraitDeLaDesignation('d', 'p'))).toEqual(parametresDe('defaire_exemplaire_facture'))
  })

  it('les paramètres, tels que le module les envoie (le drapeau baissé comme levé)', () => {
    expect(argumentsDeLaDesignation('d', 'p', 'f')).toEqual({ p_dossier_id: 'd', p_piece_id: 'p', p_facture_id: 'f' })
    expect(argumentsDuRetraitDeLaDesignation('d', 'p')).toEqual({ p_dossier_id: 'd', p_piece_id: 'p' })
    // PostgREST les lit par leur nom ; l'ordre de la signature (celui de la migration), pour qui les relit.
    expect(Object.keys(argumentsDeLaDesignation('d', 'p', 'f'))).toEqual(['p_dossier_id', 'p_piece_id', 'p_facture_id'])
    expect(Object.keys(argumentsDuRetraitDeLaDesignation('d', 'p'))).toEqual(['p_dossier_id', 'p_piece_id'])
  })
})
