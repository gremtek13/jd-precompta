import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BON_POUR_ACCORD,
  DATE_PLANCHER_DEVIS,
  dateDeLaBase,
  DEVIS_EXPORTES,
  DUREE_VALIDITE_PAR_DEFAUT_MOIS,
  ecritureDuDevis,
  etatDuDevis,
  LIBELLES_ETAT_DEVIS,
  LIGNES_MAX,
  mentionsDuDevis,
  mentionsLegalesParDefautDuDevis,
  numeroDeDevis,
  numeroTvaDuDevis,
  REFUS_DECISION_DEVIS,
  REFUS_ENREGISTREMENT_DEVIS,
  REFUS_FACTURATION_DEVIS,
  REFUS_SUPPRESSION_DEVIS,
  refusDecisionDevis,
  refusEnregistrementDevis,
  refusFacturationDevis,
  refusSuppressionDevis,
  totauxDuDevis,
  validiteParDefaut,
  type EcritureDevis,
  type SaisieDevis,
} from './devis'
import { mentionsImprimees, TAUX_ADMIS } from './factureCii'
import { MENTION_FRANCHISE, EXONERATIONS } from './statutTva'
import type { Devis, LigneDevis } from './types'
import { facture, ligne } from '../test/facturesCii'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE MODULE DES DEVIS, CONFRONTÉ À LA BASE (espace client, étape P5). Les migrations attendent l'accord du cabinet : elles
// ne sont pas dans l'export (supabase/schema), et ce que la base refuse ne peut pas s'y relire. La RÉFÉRENCE est donc
// l'essai `supabase/essais/devis.sql`, joué sur une réplique de la production munie des migrations (167 verdicts justes,
// HISTORIQUE.md, « LES DEVIS, EN BASE ») : chacun de ses contrôles exige de la base un code ET des mots. Ce test exige que
// chaque refus du module y soit exigé de la fonction qui le lève, et rejoue dans le module les écritures de l'essai : le
// même premier refus, ou aucun. Le jour où l'export porte les migrations (`DEVIS_EXPORTES`), il confronte aussi le module
// au texte même des fonctions.

const ESSAI = readFileSync(new URL('../../supabase/essais/devis.sql', import.meta.url), 'utf8')
const AUJOURD_HUI = '2026-10-10'
const DA = 'e55d0000-0000-4000-8000-0000000000a1'
const DB = 'e55d0000-0000-4000-8000-0000000000b1'

interface ControleDeLEssai {
  num: string
  genre: string
  qui: string
  droits: string | null
  ordre: string
  code: string
  attendu: string | null
}

const sansDoubles = (texte: string) => texte.replace(/''/g, "'")

function controlesDeLEssai(texte: string): ControleDeLEssai[] {
  const motif = /\('(\w+)', '(jeu|controle|fait|valeur|mutation)', '(?:[^']|'')*', '(\w+)', (null|'\w+'),\s*\$q\$([\s\S]*?)\$q\$,\s*'(\w+)', (null|'((?:[^']|'')*)'), (?:null|'\w+')\)/g
  return [...texte.matchAll(motif)].map((m) => ({
    num: m[1], genre: m[2], qui: m[3], droits: m[4] === 'null' ? null : m[4].slice(1, -1), ordre: m[5], code: m[6],
    attendu: m[8] === undefined ? null : sansDoubles(m[8]),
  }))
}

// Un motif `like` de l'essai, en expression régulière : « % » pour n'importe quoi, « _ » pour un caractère, « \x » pour x.
function likeEnRegex(motif: string): RegExp {
  let source = ''
  for (let i = 0; i < motif.length; i++) {
    const c = motif[i]
    if (c === '\\' && i + 1 < motif.length) source += motif[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (c === '%') source += '[\\s\\S]*'
    else if (c === '_') source += '.'
    else source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

// Un modèle du module, en expression régulière : chaque « % » une valeur, « %% » un signe pour cent.
function modeleEnRegex(modele: string): RegExp {
  const morceaux = modele.split('%%').map((m) => m.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+'))
  return new RegExp(`^${morceaux.join('%')}$`)
}

// Le texte qu'un motif de l'essai exige, ses jokers laissés tels quels — un « % » échappé redevient un signe pour cent.
const texteDuMotif = (motif: string) => motif.replace(/\\%/g, '%')

const FONCTIONS = ['enregistrer_devis', 'decider_devis', 'facturer_devis', 'supprimer_brouillon_devis'] as const
const fonctionAppelee = (ordre: string) => FONCTIONS.find((f) => ordre.includes(`${f}(`)) ?? null

const CONTROLES = controlesDeLEssai(ESSAI)
const controle = (num: string) => {
  const c = CONTROLES.find((x) => x.num === num)
  if (!c) throw new Error(`contrôle ${num} introuvable dans devis.sql`)
  return c
}

describe('l’essai, lu', () => {
  it('ses étapes, toutes : deux de jeu, 166 jugées — le cent-soixante-septième verdict est le bilan « rien n’est resté »', () => {
    // Le plancher qui distingue « aucun écart » d'« aveugle » : un motif qui ne reconnaîtrait plus les étapes rendrait
    // une liste vide, et toutes les confrontations ci-dessous passeraient sans rien confronter. Le compte des étapes que
    // le fichier OUVRE (une parenthèse, un numéro, un genre) est celui des étapes que le motif reconnaît en entier.
    const ouvertes = [...ESSAI.matchAll(/^\s*\('\w+', '(?:jeu|controle|fait|valeur|mutation)'/gm)].length
    expect(CONTROLES).toHaveLength(ouvertes)
    expect(CONTROLES.filter((c) => c.genre === 'jeu')).toHaveLength(2)
    expect(CONTROLES.filter((c) => c.genre !== 'jeu')).toHaveLength(166)
    expect(CONTROLES.filter((c) => c.genre === 'mutation')).toHaveLength(10)
    expect(new Set(CONTROLES.map((c) => c.num)).size).toBe(CONTROLES.length)
  })

  it('un motif « like » se lit comme la base le lit', () => {
    expect(likeEnRegex('le __/__/____.').test('le 10/10/2026.')).toBe(true)
    expect(likeEnRegex('7,5 \\% n').test('7,5 % n')).toBe(true)
    expect(likeEnRegex('7,5 \\% n').test('7,5 x n')).toBe(false)
    expect(likeEnRegex('%devis_tiers_siren_check%').test('… « devis_tiers_siren_check » …')).toBe(true)
    expect(modeleEnRegex('le taux de % %% n').test('le taux de 7,5 % n')).toBe(true)
    expect(modeleEnRegex('le taux de % %% n').test('le taux de 7,5 n')).toBe(false)
  })
})

// ── 1. Chaque refus du module est exigé de la base par l'essai, sous ses mots, de la fonction qui le lève ────────────────

const CODE_ATTENDU = (cle: string) => (cle === 'acces' ? '42501' : cle === 'introuvable' ? 'P0002' : '22023')

describe('les refus du module sont ceux que la base rend', () => {
  const listes = [
    ['enregistrer_devis', REFUS_ENREGISTREMENT_DEVIS],
    ['decider_devis', REFUS_DECISION_DEVIS],
    ['facturer_devis', REFUS_FACTURATION_DEVIS],
    ['supprimer_brouillon_devis', REFUS_SUPPRESSION_DEVIS],
  ] as const

  for (const [fonction, liste] of listes) {
    it(`${fonction} : chaque refus est exigé par un contrôle de l’essai, sous son code et ses mots`, () => {
      const exiges = CONTROLES.filter((c) => c.genre === 'controle' && c.code !== 'OK' && c.attendu != null
        && fonctionAppelee(c.ordre) === fonction)
      for (const r of liste) {
        const temoins = exiges.filter((c) => modeleEnRegex(r.modele).test(texteDuMotif(c.attendu as string)))
        expect(temoins.length, `${fonction} : le refus « ${r.cle} » n'est exigé par aucun contrôle de devis.sql`).toBeGreaterThan(0)
        for (const c of temoins) expect(c.code, `${fonction}, contrôle ${c.num}`).toBe(CODE_ATTENDU(r.cle))
      }
      expect(new Set(liste.map((r) => r.cle)).size).toBe(liste.length)
    })
  }

  it('l’accès d’abord, partout : refusé sous les mêmes mots, avant « introuvable »', () => {
    for (const [, liste] of listes) expect(liste.slice(0, 2).map((r) => r.cle)).toEqual(['acces', 'introuvable'])
    // Sans droit, un devis qui n'existe pas : le refus d'accès (contrôles 12 et 82b).
    for (const num of ['12', '82b']) expect([controle(num).code, controle(num).attendu]).toEqual(['42501', 'Accès refusé à ce dossier.'])
  })
})

// ── 2. Les écritures de l'essai, rejouées dans le module ─────────────────────────────────────────────────────────────
// Chaque contrôle qui crée un devis par ses valeurs écrites en clair, sous un compte qui en a le droit : le module doit
// dire le MÊME premier refus que la base, ou aucun quand elle accepte. Une contrainte des mentions (23514) vient après les
// refus de la fonction : le module n'en dit rien, `refusDesMentions` les dit sur la saisie.

describe('les créations de l’essai, rejouées dans le module', () => {
  const motif = /enregistrer_devis\('\{DA\}',\s*null,\s*'((?:[^']|'')*)'::jsonb,\s*'((?:[^']|'')*)'::jsonb,\s*(true|false)\)/
  const rejouables = CONTROLES.filter((c) => (c.genre === 'controle' || c.genre === 'fait')
    && (c.droits === 'ventes' || c.qui === 'chef') && motif.test(c.ordre))

  it('assez d’écritures pour juger : au moins cinquante-cinq, refus et acceptations', () => {
    expect(rejouables.length).toBeGreaterThanOrEqual(55)
    expect(rejouables.filter((c) => c.code === '22023').length).toBeGreaterThanOrEqual(40)
    expect(rejouables.filter((c) => c.code === 'OK').length).toBeGreaterThanOrEqual(8)
  })

  for (const c of rejouables) {
    it(`contrôle ${c.num} : ${c.code === 'OK' ? 'accepté' : c.code}`, () => {
      const m = motif.exec(c.ordre) as RegExpExecArray
      const e: EcritureDevis = { devis: JSON.parse(sansDoubles(m[1])), lignes: JSON.parse(sansDoubles(m[2])), emettre: m[3] === 'true' }
      const refus = refusEnregistrementDevis(DA, { nouveau: true }, e, AUJOURD_HUI)
      if (c.code === '22023') {
        expect(refus?.message ?? 'accepté').toMatch(likeEnRegex(c.attendu as string))
      } else {
        expect(['OK', '23514']).toContain(c.code)
        expect(refus).toBeNull()
      }
    })
  }
})

// ── 3. Les refus qui dépendent de ce que la base porte : sous les mots de l'essai ────────────────────────────────────

function devisFictif(o: Partial<Devis> = {}): Devis {
  return {
    id: 'dv', dossier_id: DA, numero: null, statut: 'brouillon', date_emission: '2026-09-15', date_validite: '2026-09-16',
    objet: null, tiers_nom: 'ESSAI', tiers_adresse: null, tiers_siret: null, tiers_email: null, type_client: null,
    tiers_siren: null, tiers_adresse_electronique: null, code_service: null, numero_engagement: null, nature_operation: null,
    date_prestation: null, periode_debut: null, periode_fin: null, livraison_adresse: null, livraison_code_postal: null,
    livraison_ville: null, livraison_pays: null,
    lignes: [{ designation: 'essai', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
    montant_ht: 100, montant_tva: 20, montant_ttc: 120, conditions: null, mentions_legales: null, notes: null,
    emetteur_nom: 'ESSAI', emetteur_siret: null, emetteur_adresse: null, cree_par: null, cree_le: '2026-09-15T08:00:00Z',
    emis_par: null, emis_le: null, reponse: null, date_reponse: null, decide_par: null, decide_le: null,
    ...o,
  }
}

// Les devis de l'essai, tels que la base les porte au moment des contrôles cités.
const DV1 = devisFictif({ numero: 'D2026-0002', statut: 'emis', date_emission: '2026-09-20', date_validite: '2026-10-20' })
const DV1_REFUSE = { ...DV1, reponse: 'refusee' as const, date_reponse: '2026-09-25' }
const DV2 = devisFictif({ numero: 'D2026-0001', statut: 'emis' })
const DV2_ACCEPTE = { ...DV2, reponse: 'acceptee' as const, date_reponse: '2026-09-20' }
const DV3 = devisFictif({ numero: 'D2026-0003', statut: 'emis', date_emission: '2026-09-21', date_validite: '2026-12-31' })
const DV4 = devisFictif({ date_emission: '2026-09-22', date_validite: '2026-10-22' })
const DVB = devisFictif({ dossier_id: DB })

// Le verdict que l'essai exige de la base, exigé du module : aucun refus quand elle accepte, sinon ses mots.
const exige = (num: string, refus: { message: string } | null) => {
  const c = controle(num)
  if (c.code === 'OK') expect(refus, `contrôle ${num}`).toBeNull()
  else expect(refus?.message ?? 'accepté', `contrôle ${num}`).toMatch(likeEnRegex(c.attendu as string))
}

describe('les refus qui lisent la base, sous les mots de l’essai', () => {
  const ecriture: EcritureDevis = {
    devis: { tiers_nom: 'ESSAI', date_emission: '2026-09-15', date_validite: '2026-10-15', montant_ht: 100, montant_tva: 20, montant_ttc: 120 },
    lignes: [{ designation: 'essai', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
    emettre: false,
  }

  it('enregistrer_devis : introuvable, d’un autre dossier, émis — avant le nom du client', () => {
    exige('10', refusEnregistrementDevis(DA, { nouveau: false, devis: null }, ecriture, AUJOURD_HUI))
    exige('11', refusEnregistrementDevis(DA, { nouveau: false, devis: DVB }, ecriture, AUJOURD_HUI))
    exige('33', refusEnregistrementDevis(DA, { nouveau: false, devis: DV2 }, ecriture, AUJOURD_HUI))
    exige('33b', refusEnregistrementDevis(DA, { nouveau: false, devis: DV2 }, { ...ecriture, devis: { tiers_nom: '' }, lignes: [] }, AUJOURD_HUI))
    expect(refusEnregistrementDevis(DA, { nouveau: false, devis: DV4 }, ecriture, AUJOURD_HUI)).toBeNull()
  })

  it('decider_devis : chaque refus, dans son ordre', () => {
    const decision = (reponse: string | null, dateReponse: string | null, horsValidite = false) => ({ reponse, dateReponse, horsValidite })
    exige('43', refusDecisionDevis(DA, null, decision('acceptee', '2026-09-25'), AUJOURD_HUI))
    expect(refusDecisionDevis(DA, DVB, decision('acceptee', '2026-09-25'), AUJOURD_HUI)?.cle).toBe('introuvable')
    exige('44', refusDecisionDevis(DA, DV4, decision('acceptee', '2026-09-25'), AUJOURD_HUI))
    exige('44b', refusDecisionDevis(DA, DV4, decision('peut-être', null), AUJOURD_HUI))
    exige('45', refusDecisionDevis(DA, DV1, decision('acceptée', '2026-09-25'), AUJOURD_HUI))
    exige('45b', refusDecisionDevis(DA, DV1, decision(null, '2026-09-25'), AUJOURD_HUI))
    exige('45c', refusDecisionDevis(DA, DV1, decision('peut-être', null), AUJOURD_HUI))
    exige('46', refusDecisionDevis(DA, DV1, decision('refusee', null), AUJOURD_HUI))
    exige('47', refusDecisionDevis(DA, DV1, decision('refusee', '2026-09-19'), AUJOURD_HUI))
    exige('47b', refusDecisionDevis(DA, DV1, decision('refusee', '2026-09-20'), AUJOURD_HUI))
    exige('48', refusDecisionDevis(DA, DV1, decision('refusee', '2099-01-01'), AUJOURD_HUI))
    exige('49', refusDecisionDevis(DA, DV2, decision('acceptee', '2026-09-20'), AUJOURD_HUI))
    exige('49b', refusDecisionDevis(DA, DV2, decision('acceptee', '2026-09-16'), AUJOURD_HUI))
    exige('49c', refusDecisionDevis(DA, DV2, decision('refusee', '2026-09-20'), AUJOURD_HUI))
    exige('49d', refusDecisionDevis(DA, DV2, decision('acceptee', '2099-01-01'), AUJOURD_HUI))
    exige('M4', refusDecisionDevis(DA, DV2, decision('acceptee', '2026-09-20', true), AUJOURD_HUI))
    exige('51', refusDecisionDevis(DA, DV1_REFUSE, decision('acceptee', '2026-09-26'), AUJOURD_HUI))
    exige('51b', refusDecisionDevis(DA, DV1_REFUSE, decision('peut-être', null), AUJOURD_HUI))
    // Ce que la base a accepté, le module l'accepte : le refus de DV1, l'acceptation confirmée de DV2.
    exige('50', refusDecisionDevis(DA, DV1, decision('refusee', '2026-09-25'), AUJOURD_HUI))
    exige('52', refusDecisionDevis(DA, DV2, decision('acceptee', '2026-09-20', true), AUJOURD_HUI))
  })

  it('facturer_devis : chaque refus, dans son ordre', () => {
    exige('63', refusFacturationDevis(DA, null, null))
    exige('64', refusFacturationDevis(DA, DV4, null))
    exige('65', refusFacturationDevis(DA, DV3, null))
    exige('66', refusFacturationDevis(DA, DV1_REFUSE, null))
    exige('69', refusFacturationDevis(DA, DV2_ACCEPTE, { numero: null }))
    exige('74', refusFacturationDevis(DA, DV2_ACCEPTE, { numero: 'F2026-0001' }))
    // Transformé, puis de nouveau une fois son brouillon de facture supprimé.
    exige('67', refusFacturationDevis(DA, DV2_ACCEPTE, null))
    exige('72', refusFacturationDevis(DA, DV2_ACCEPTE, null))
    expect(refusFacturationDevis(DA, { ...DV2_ACCEPTE, dossier_id: DB }, null)?.cle).toBe('introuvable')
  })

  it('supprimer_brouillon_devis : chaque refus, dans son ordre', () => {
    exige('83', refusSuppressionDevis(DA, null))
    exige('84', refusSuppressionDevis(DA, DVB))
    exige('85', refusSuppressionDevis(DA, DV3))
    exige('86', refusSuppressionDevis(DA, DV4))
    exige('88', refusSuppressionDevis(DB, DVB))
  })
})

// ── 4. Le jour où l'export porte les migrations ──────────────────────────────────────────────────────────────────────

const messagesSql = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => sansDoubles(m[1]))
const exportPorte = (fonction: string) =>
  fichiersDuSchema().some((f) => new RegExp(`create (or replace )?function public\\.${fonction}\\(`).test(f.texte))

describe('DEVIS_EXPORTES dit ce que porte l’export', () => {
  it('les deux migrations ensemble, et le drapeau avec elles', () => {
    const portees = FONCTIONS.map(exportPorte)
    expect(new Set(portees).size, 'l’export porte une partie seulement des fonctions des devis').toBe(1)
    expect(portees[0], 'DEVIS_EXPORTES ne dit plus ce que porte l’export').toBe(DEVIS_EXPORTES)
  })

  it('exportées, les fonctions disent les refus du module, dans le même ordre', () => {
    if (!DEVIS_EXPORTES) return
    expect(messagesSql(derniereDefinitionSql('enregistrer_devis'))).toEqual(REFUS_ENREGISTREMENT_DEVIS.map((r) => r.modele))
    expect(messagesSql(derniereDefinitionSql('decider_devis'))).toEqual(REFUS_DECISION_DEVIS.map((r) => r.modele))
    expect(messagesSql(derniereDefinitionSql('facturer_devis'))).toEqual(REFUS_FACTURATION_DEVIS.map((r) => r.modele))
    expect(messagesSql(derniereDefinitionSql('supprimer_brouillon_devis'))).toEqual(REFUS_SUPPRESSION_DEVIS.map((r) => r.modele))
  })

  it('exportée, enregistrer_devis lit les clés que le module écrit, et les taux de la liste admise', () => {
    if (!DEVIS_EXPORTES) return
    const sql = derniereDefinitionSql('enregistrer_devis')
    const lues = [...new Set([...sql.matchAll(/p_devis->>?'(\w+)'/g)].map((m) => m[1]))].sort()
    expect(Object.keys(ecritureDuDevis(SAISIE, false).devis as object).sort()).toEqual(lues)
    const taux = /v_taux not in \(([^)]*)\)/.exec(sql) as RegExpExecArray
    expect(taux[1].split(',').map((x) => Number(x.trim()))).toEqual([...TAUX_ADMIS])
    expect(sql).toContain(`between 1 and ${LIGNES_MAX}`)
    expect(sql).toContain(`v_date < date '${DATE_PLANCHER_DEVIS}'`)
  })
})

// ── 5. Les calculs ───────────────────────────────────────────────────────────────────────────────────────────────────

const SAISIE: SaisieDevis = {
  dateEmission: '2026-09-15', dateValidite: '2026-10-15', objet: ' Rénovation ', tiersNom: ' Client ', tiersAdresse: '',
  tiersSiret: '123 456 789 00012', tiersEmail: '',
  mentions: {
    typeClient: 'assujetti', siren: '123456789', adresseElectronique: '', codeService: 'X', numeroEngagement: 'Y',
    nature: 'services', prestation: 'date', datePrestation: '2026-10-01', periodeDebut: '2026-10-01', periodeFin: '2026-10-31',
    livraisonAilleurs: true, livraisonAdresse: '1 rue', livraisonCodePostal: '75001', livraisonVille: 'Paris', livraisonPays: 'FR',
  },
  lignes: [
    { designation: 'Prestation', quantite: 1, prix_unitaire_ht: 0.125, taux_tva: 20 },
    { designation: 'Option', quantite: 2, prix_unitaire_ht: 25.25, taux_tva: 5.5 },
  ],
  conditions: '  ', mentionsLegales: 'Mentions', notes: '',
  emetteurNom: 'Dossier', emetteurSiret: '12345678200010', emetteurAdresse: null,
}

describe('les calculs du module', () => {
  it('la validité proposée : un mois, au même quantième, ou au dernier jour du mois', () => {
    expect(DUREE_VALIDITE_PAR_DEFAUT_MOIS).toBe(1)
    expect(validiteParDefaut('2026-09-15')).toBe('2026-10-15')
    expect(validiteParDefaut('2026-01-31')).toBe('2026-02-28')
    expect(validiteParDefaut('2028-01-31')).toBe('2028-02-29')
    expect(validiteParDefaut('2026-12-10')).toBe('2027-01-10')
  })

  it('le numéro : la série D de l’année, quatre chiffres au moins, tous au-delà', () => {
    expect(numeroDeDevis(2026, 1)).toBe('D2026-0001')
    expect(numeroDeDevis(2025, 42)).toBe('D2025-0042')
    expect(numeroDeDevis(2026, 12345)).toBe('D2026-12345')
    // Ceux que la base a donnés dans l'essai : le chef puis le client dans la même série, une série par année de la
    // date du devis, la reprise au plus haut numéro émis.
    expect(['30', '31', '37', '38b'].map((num) => controle(num).attendu))
      .toEqual([numeroDeDevis(2026, 1), numeroDeDevis(2026, 2), numeroDeDevis(2025, 1), numeroDeDevis(2026, 3)])
  })

  it('les totaux : ligne par ligne comme calculerLigne, le demi-centime loin de zéro, sommés en centimes', () => {
    expect(totauxDuDevis([{ designation: 'x', quantite: 1, prix_unitaire_ht: 0.125, taux_tva: 20 }]))
      .toEqual({ montant_ht: 0.13, montant_tva: 0.03, montant_ttc: 0.16 })
    expect(totauxDuDevis([
      { designation: 'x', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 },
      { designation: 'y', quantite: 1, prix_unitaire_ht: -100, taux_tva: 20 },
    ])).toEqual({ montant_ht: 0, montant_tva: 0, montant_ttc: 0 })
    expect(totauxDuDevis([])).toEqual({ montant_ht: 0, montant_tva: 0, montant_ttc: 0 })
  })

  it('l’état : déduit, la validité jugée au jour de Paris, valable tout le jour qu’il imprime', () => {
    const emis = devisFictif({ statut: 'emis', numero: 'D2026-0001', date_validite: '2026-10-10' })
    expect(etatDuDevis(devisFictif(), false, AUJOURD_HUI)).toBe('brouillon')
    expect(etatDuDevis(emis, false, '2026-10-10')).toBe('en_attente')
    expect(etatDuDevis(emis, false, '2026-10-11')).toBe('expire')
    expect(etatDuDevis({ ...emis, reponse: 'refusee' }, false, '2026-12-01')).toBe('refuse')
    expect(etatDuDevis({ ...emis, reponse: 'acceptee' }, false, '2026-12-01')).toBe('accepte')
    expect(etatDuDevis({ ...emis, reponse: 'acceptee' }, true, '2026-12-01')).toBe('facture')
    // Un brouillon ne s'est engagé à rien : il n'expire pas, et une facture ne s'en tire pas.
    expect(etatDuDevis(devisFictif({ date_validite: '2020-01-01' }), true, AUJOURD_HUI)).toBe('brouillon')
    expect(Object.keys(LIBELLES_ETAT_DEVIS).sort()).toEqual(['accepte', 'brouillon', 'en_attente', 'expire', 'facture', 'refuse'])
  })

  it('une date, comme `::date` la lit : la forme, le calendrier grégorien proleptique, pas d’an 0', () => {
    expect(dateDeLaBase('2026-09-15')).toBe('2026-09-15')
    expect(dateDeLaBase('2028-02-29')).toBe('2028-02-29')
    expect(dateDeLaBase('0004-02-29')).toBe('0004-02-29')
    expect(dateDeLaBase('0001-01-01')).toBe('0001-01-01')
    for (const v of ['2026-02-29', '0100-02-29', '0000-01-01', '2026-13-01', '2026-00-10', '2026-04-31', '2026-9-1', 'today',
      ' 2026-09-15', '2026-09-15 ', '20260915', null, undefined, 20260915]) {
      expect(dateDeLaBase(v), String(v)).toBeNull()
    }
  })

  it('l’écriture : les totaux des lignes envoyées, les mentions fermées à nul, les textes sans leurs blancs', () => {
    const e = ecritureDuDevis(SAISIE, true)
    expect(e.emettre).toBe(true)
    expect(e.lignes).toEqual(SAISIE.lignes)
    expect(e.devis).toMatchObject({
      tiers_nom: 'Client', objet: 'Rénovation', tiers_adresse: null, tiers_siret: '12345678900012', tiers_email: null,
      type_client: 'assujetti', tiers_siren: '123456789', code_service: null, numero_engagement: null,
      nature_operation: 'services', date_prestation: '2026-10-01', periode_debut: null, periode_fin: null,
      livraison_adresse: null, conditions: null, mentions_legales: 'Mentions', notes: null,
      emetteur_nom: 'Dossier', emetteur_siret: '12345678200010', emetteur_adresse: null,
    })
    const t = totauxDuDevis(SAISIE.lignes)
    expect(e.devis).toMatchObject({ montant_ht: t.montant_ht, montant_tva: t.montant_tva, montant_ttc: t.montant_ttc })
    // Ce qu'elle écrit, la base l'accepte : aucun refus de la fonction.
    expect(refusEnregistrementDevis(DA, { nouveau: true }, e, AUJOURD_HUI)).toBeNull()
  })
})

// ── 6. Les refus de l'enregistrement, cas par cas ───────────────────────────────────────────────────────────────────

describe('refusEnregistrementDevis, cas que l’essai ne joue pas', () => {
  const base = (devis: Record<string, unknown>, lignes: unknown = [{ designation: 'x', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }], emettre = false) =>
    refusEnregistrementDevis(DA, { nouveau: true }, {
      devis: { tiers_nom: 'ESSAI', date_emission: '2026-09-15', date_validite: '2026-10-15', montant_ht: 100, montant_tva: 20, montant_ttc: 120, emetteur_nom: 'E', ...devis },
      lignes, emettre,
    }, AUJOURD_HUI)

  it('btrim ne retire que les espaces : une tabulation ou une espace insécable font un nom', () => {
    expect(base({ tiers_nom: '\t' })).toBeNull()
    expect(base({ tiers_nom: ' ' })).toBeNull()
    expect(base({ tiers_nom: '   ' })?.cle).toBe('client_absent')
    expect(base({ tiers_nom: 42 })).toBeNull()
    expect(base({ tiers_nom: null })?.cle).toBe('client_absent')
  })

  it('un en-tête qui n’est pas un objet n’a ni nom ni date', () => {
    expect(refusEnregistrementDevis(DA, { nouveau: true }, { devis: ['ESSAI'], lignes: [], emettre: false }, AUJOURD_HUI)?.cle).toBe('client_absent')
    expect(refusEnregistrementDevis(DA, { nouveau: true }, { devis: null, lignes: [], emettre: false }, AUJOURD_HUI)?.cle).toBe('client_absent')
  })

  it('une validité le jour même est juste ; la veille, non', () => {
    expect(base({ date_validite: '2026-09-15' })).toBeNull()
    expect(base({ date_validite: '2026-09-14' })?.message)
      .toBe("Un devis n'expire pas avant sa date : valable jusqu'au 14/09/2026, il est daté du 15/09/2026.")
  })

  it('les lignes : leur nombre, leur forme, et NaN qui part en JSON comme `null`', () => {
    const l = (o: Record<string, unknown>) => [{ designation: 'x', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, ...o }]
    expect(base({}, Array.from({ length: LIGNES_MAX }, () => l({})[0]), false)?.cle).toBe('montants_incoherents')
    expect(base({}, Array.from({ length: LIGNES_MAX + 1 }, () => l({})[0]))?.cle).toBe('lignes_nombre')
    expect(base({}, l({ quantite: Number.NaN }))?.message).toBe(
      "La ligne 1 n'est pas une ligne de devis : une désignation, une quantité, un prix unitaire hors taxes et un taux de TVA.")
    expect(base({}, l({ taux_tva: Number.POSITIVE_INFINITY }))?.cle).toBe('ligne_illisible')
    expect(base({}, [null])?.cle).toBe('ligne_illisible')
    expect(base({}, [[1, 2]])?.cle).toBe('ligne_illisible')
    expect(base({}, l({ designation: 7 }))?.cle).toBe('ligne_illisible')
  })

  it('les décimales se comptent sur l’écriture du nombre, exposant compris', () => {
    const l = (o: Record<string, unknown>) => [{ designation: 'x', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, ...o }]
    expect(base({}, l({ quantite: 1e-7 }))?.cle).toBe('quantite_invalide')
    // 0,0001 × 1 000 000 : quatre décimales, une ligne de 100 € — celle de l'en-tête.
    expect(base({}, l({ quantite: 0.0001, prix_unitaire_ht: 1e6 }))).toBeNull()
    // 1e21 s'écrit « 1e+21 » en JSON, et la base le lit comme un entier : aucune décimale, mais hors borne.
    expect(base({}, l({ quantite: 1e21 }))?.cle).toBe('ligne_hors_borne')
    expect(base({}, l({ prix_unitaire_ht: 0.000001, quantite: 1 }))?.cle).toBe('montants_incoherents')
    expect(base({}, l({ prix_unitaire_ht: 1e-7 }))?.cle).toBe('prix_invalide')
    expect(base({}, l({ quantite: -0 }))?.cle).toBe('quantite_invalide')
  })

  it('la borne d’une ligne se juge en décimal exact, des deux côtés', () => {
    const l = (q: number, p: number) => [{ designation: 'x', quantite: q, prix_unitaire_ht: p, taux_tva: 0 }]
    // 99 999,9999 × 100 000,000001 vaut 9 999 999 999,99999… : sous la borne, au dernier chiffre près.
    expect(base({}, l(99999.9999, 100000.000001))?.cle).toBe('montants_incoherents')
    expect(base({}, l(100000, 100000))?.cle).toBe('ligne_hors_borne')
    expect(base({}, l(1, -10_000_000_000))?.cle).toBe('ligne_hors_borne')
    // Le plus grand prix à six décimales qu'un nombre JSON écrive tel quel sous la borne.
    expect(base({}, l(1, 9_999_999_999.999998))?.cle).toBe('montants_incoherents')
  })

  it('les taux : la liste admise, un taux écrit autrement reste le même nombre', () => {
    for (const taux of TAUX_ADMIS) {
      const t = totauxDuDevis([{ designation: 'x', quantite: 1, prix_unitaire_ht: 100, taux_tva: taux }])
      expect(base({ ...t }, [{ designation: 'x', quantite: 1, prix_unitaire_ht: 100, taux_tva: taux }]), String(taux)).toBeNull()
    }
    expect(base({}, [{ designation: 'x', quantite: 1, prix_unitaire_ht: 100, taux_tva: 1e-7 }])?.message)
      .toBe("Ligne 1 : le taux de 0,0000001 % n'est pas un taux de TVA admis.")
  })

  it('les montants de l’en-tête : des nombres au centime, ceux des lignes', () => {
    expect(base({ montant_ht: 100.001 })?.cle).toBe('montants_incoherents')
    expect(base({ montant_ht: '100' })?.cle).toBe('montants_incoherents')
    expect(base({ montant_ttc: undefined })?.cle).toBe('montants_incoherents')
    expect(base({ montant_ttc: 121 })?.message)
      .toBe('Les montants du devis ne sont pas ceux de ses lignes : 100,00 € HT, 20,00 € de TVA, 120,00 € TTC.')
  })

  it('émettre : pas daté de l’avenir à Paris — aujourd’hui oui —, un total positif, l’émetteur nommé', () => {
    expect(base({ date_emission: AUJOURD_HUI, date_validite: '2026-11-10' }, undefined, true)).toBeNull()
    expect(base({ date_emission: '2026-10-11', date_validite: '2026-11-10' }, undefined, true)?.message)
      .toBe("Un devis ne s'émet pas daté de l'avenir : nous sommes le 10/10/2026.")
    expect(base({ emetteur_nom: '  ' }, undefined, true)?.cle).toBe('emission_emetteur')
    expect(base({ emetteur_nom: '  ' }, undefined, false)).toBeNull()
    const remise = [{ designation: 'x', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }, { designation: 'r', quantite: 1, prix_unitaire_ht: -150, taux_tva: 20 }]
    expect(base({ montant_ht: -50, montant_tva: -10, montant_ttc: -60 }, remise, true)?.cle).toBe('emission_total')
    expect(base({ montant_ht: -50, montant_tva: -10, montant_ttc: -60 }, remise, false)).toBeNull()
  })
})

// ── 7. Les mentions ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('les mentions du devis', () => {
  const complet = devisFictif({
    date_validite: '2026-10-15', tiers_siren: '987654324', nature_operation: 'mixte', date_prestation: '2026-10-01',
    livraison_adresse: '1 rue\nde l’Essai', livraison_code_postal: '75001', livraison_ville: 'Paris', livraison_pays: 'BE',
    type_client: 'organisme_public', code_service: 'SERVICE', numero_engagement: 'ENG-1',
  })

  it('la validité d’abord, puis celles du client, sous les libellés de la facture imprimée', () => {
    const m = mentionsDuDevis(complet)
    expect(m[0]).toEqual({ libelle: 'Devis valable jusqu’au', texte: '15/10/2026' })
    const f = mentionsImprimees(facture([ligne()], {
      tiers_siren: complet.tiers_siren, nature_operation: complet.nature_operation, livraison_adresse: complet.livraison_adresse,
      livraison_code_postal: complet.livraison_code_postal, livraison_ville: complet.livraison_ville,
      livraison_pays: complet.livraison_pays, type_client: complet.type_client, code_service: complet.code_service,
      numero_engagement: complet.numero_engagement, option_debits: null,
    }))
    for (const libelle of ['SIREN du client', 'Opérations', 'Adresse de livraison', 'Code service', 'Numéro d’engagement']) {
      expect(m.find((x) => x.libelle === libelle), libelle).toEqual(f.find((x) => x.libelle === libelle))
    }
    expect(m.find((x) => x.libelle === 'Exécution prévue le')?.texte).toBe('01/10/2026')
  })

  it('une période prévue, et rien de ce qui manque', () => {
    const m = mentionsDuDevis(devisFictif({ periode_debut: '2026-10-01', periode_fin: '2026-10-31', type_client: 'assujetti', code_service: 'X' }))
    expect(m.map((x) => x.libelle)).toEqual(['Devis valable jusqu’au', 'Exécution prévue'])
    expect(m[1].texte).toBe('du 01/10/2026 au 31/10/2026')
    expect(mentionsDuDevis(devisFictif()).map((x) => x.libelle)).toEqual(['Devis valable jusqu’au'])
  })

  it('les mentions légales proposées : la mention de TVA du statut, rien d’autre', () => {
    expect(mentionsLegalesParDefautDuDevis('franchise', null)).toBe(MENTION_FRANCHISE)
    expect(mentionsLegalesParDefautDuDevis('exonere', 'cgi_261_4_1')).toBe(EXONERATIONS[0].mention)
    expect(mentionsLegalesParDefautDuDevis('redevable', null)).toBe('')
    expect(mentionsLegalesParDefautDuDevis(null, null)).toBe('')
    expect(BON_POUR_ACCORD).toMatch(/Bon pour accord/)
  })

  it('le numéro de TVA de l’émetteur : celui de la facture imprimée, aucun sans statut ni case', () => {
    const d = { emetteur_siret: '12345678200010' }
    expect(numeroTvaDuDevis(d, { statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false })).toBe('FR11123456782')
    expect(numeroTvaDuDevis(d, { statut_tva: 'franchise', article_exoneration: null, numero_tva_attribue: false })).toBeNull()
    expect(numeroTvaDuDevis(d, { statut_tva: 'franchise', article_exoneration: null, numero_tva_attribue: true })).toBe('FR11123456782')
    expect(numeroTvaDuDevis(d, { statut_tva: null, article_exoneration: null, numero_tva_attribue: true })).toBeNull()
  })
})

// Un jeu de lignes pour vérifier que le type de la colonne est celui que le module manipule.
const _lignes: LigneDevis[] = SAISIE.lignes
void _lignes
