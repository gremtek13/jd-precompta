import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COMPTE_COTISATIONS_EXPLOITANT, COMPTE_EXPLOITANT } from './comptes'
import {
  argumentsDeLaDeclaration, avertissementRetraitPaiementPersonnel, avertissementSuppressionEcheancePayee,
  confirmationPaiementPersonnel, ecritureDuPaiementPersonnel, libelleDuPaiementPersonnel, paiementsPersonnelsAReprendre,
  RAISON_ECRITURE_A_REPRENDRE, REFUS_PAIEMENT_PERSONNEL, RETRAIT_EXPORTE, REFUS_RETRAIT_PAIEMENT_PERSONNEL, refusPaiementPersonnel,
  refusRetraitPaiementPersonnel, type ContextePaiementPersonnel,
} from './cotisationPersonnelle'
import { remplirModele } from './encaissementsFactures'
import type { ModeleComptable } from './engagement'
import { formatMoney } from './format'
import type { CompteNotesDeFrais, CotisationDeclaree, EcritureBrouillon } from './types'
import { NON_VALIDEE } from '../test/ecritures'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// L'ÉCHÉANCE DE COTISATION PAYÉE DEPUIS LE COMPTE PERSONNEL (ligne 26.6), confrontée à ce qui fait foi : la migration
// `paiement_personnel_des_cotisations` — le texte de `enregistrer_paiement_personnel_cotisation` que l'export porte — pour
// l'ordre et les mots des refus, les comptes, les sens et les bornes ; l'essai joué en production
// (supabase/essais/cotisationPersonnelle.sql) pour les messages que la base a rendus, valeurs comprises, et pour les
// écritures qu'elle a ACCEPTÉES ou refusées, lues dans l'essai avec les échéances de son jeu. Le RETRAIT vit dans une
// migration que le cabinet colle (`retrait_du_paiement_personnel` : sa fonction supprime des lignes du brouillon) : son
// essai (retraitPaiementPersonnel.sql) fait foi, et le texte de sa fonction, que l'export porte depuis le 10/10/2026
// (`RETRAIT_EXPORTE`).

const ESSAI = readFileSync(new URL('../../supabase/essais/cotisationPersonnelle.sql', import.meta.url), 'utf8')
const ESSAI_RETRAIT = readFileSync(new URL('../../supabase/essais/retraitPaiementPersonnel.sql', import.meta.url), 'utf8')

// LA MIGRATION DU RETRAIT S'EST COLLÉE PAR LE CABINET (10/10/2026), et son fichier est dans supabase/schema : ses refus se
// confrontent à son essai ET au texte de la fonction exportée. Le test qui lit l'export tient le drapeau
// `RETRAIT_EXPORTE` du module égal à ce que porte l'export — et avec lui le bouton « Retirer ce paiement » de l'onglet
// Cotisations : un seul drapeau pour les deux.

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }
const AUJOURD_HUI = '2026-10-09'

function cotisation(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
  return {
    id: 'c1', dossier_id: 'd1', echeance: '2026-03-05', montant_appele: 1000, montant_verse: null, montant_csg_crds: 300,
    previsionnel: false, created_at: '2026-02-02T10:00:00Z', paiement_personnel_le: null, ...o,
  }
}

function contexte(o: Partial<ContextePaiementPersonnel> = {}): ContextePaiementPersonnel {
  return { modele: TRESORERIE, mouvement: null, anneesValidees: [], ouverture: null, aujourdHui: AUJOURD_HUI, ...o }
}

function ecriture(o: Partial<EcritureBrouillon> = {}): EcritureBrouillon {
  return {
    id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: '2026-03-10', compte: COMPTE_COTISATIONS_EXPLOITANT,
    libelle: 'Cotisation', montant: 700, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null,
    declaration_tva_id: null, cotisation_id: 'c1', ...NON_VALIDEE, created_at: '2026-03-11T10:00:00Z', ...o,
  }
}

// L'écriture qu'écrirait la base pour l'échéance `c1` payée le 10/03/2026 : 700 € au 646000, face au 108000.
const ECRITE = [
  ecriture({ id: 'e1' }),
  ecriture({ id: 'e2', compte: COMPTE_EXPLOITANT, sens: 'credit' }),
]

// ── La migration et l'essai, lus ─────────────────────────────────────────────────────────────────────────────────────

const sqlDeLaDeclaration = () => derniereDefinitionSql('enregistrer_paiement_personnel_cotisation')

// Les messages des `raise exception` d'une fonction, dans l'ordre du texte, l'apostrophe doublée de SQL rendue simple.
function messagesSql(sql: string): string[] {
  return [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
}

// Ce qui suit le message d'un `raise exception`, jusqu'à `using errcode` : les valeurs qui remplissent ses « % »,
// découpées sur les virgules de premier niveau, hors chaînes.
function argumentsSql(sql: string): string[][] {
  return [...sql.matchAll(/raise exception '(?:[^']|'')*'([\s\S]*?)using errcode/g)].map((m) => {
    const texte = m[1].replace(/\s+/g, ' ').trim().replace(/^,\s*/, '')
    if (!texte) return []
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
  })
}

// Une étape du moteur d'essai : `array['controle', '15. …', 'chef', $q$…$q$, '22023', 'message']` — son genre, son
// numéro, son appel, le code attendu (« OK » pour un appel qui doit passer) et le message attendu de la base (un motif
// LIKE, qui finit alors par « % »), l'apostrophe doublée de SQL rendue simple.
interface Etape { genre: string; numero: string; appel: string; code: string; attendu: string }

function etapesDe(essai: string): Etape[] {
  return [...essai.matchAll(/array\['(jeu|controle|fait|valeur)', '((?:[^']|'')*)', '\w+', \$q\$([\s\S]*?)\$q\$,\s*'(\w*)', '((?:[^']|'')*)'\]/g)]
    .map(([, genre, titre, appel, code, attendu]) => ({
      genre, numero: /^(\w+)\./.exec(titre)?.[1] ?? '', appel, code, attendu: attendu.replace(/''/g, "'"),
    }))
}

function etape(essai: string, numero: string): Etape {
  const trouvees = etapesDe(essai).filter((e) => e.numero === numero)
  expect(trouvees, `l’étape ${numero} de l’essai`).toHaveLength(1)
  return trouvees[0]
}

// Le message que l'essai attend de la base — qu'elle a rendu en production — comparé à celui que le module écrirait :
// égal, ou conforme au motif LIKE de l'essai quand il en porte un (« % » pour toute suite, « _ » pour un caractère).
function commeLaBase(essai: string, numero: string, recu: string | null | undefined) {
  const { attendu } = etape(essai, numero)
  if (!/[%_]/.test(attendu)) {
    expect(recu, numero).toBe(attendu)
    return
  }
  const motif = attendu.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '[\\s\\S]*').replace(/_/g, '.')
  expect(new RegExp(`^${motif}$`).test(recu ?? ''), `${numero} : « ${recu} » contre « ${attendu} »`).toBe(true)
}

// Les valeurs d'un `values (…), (…)` de l'essai, colonne par colonne, sans les guillemets ni les accolades des
// identifiants jetables.
function lignesInserees(essai: string, table: string): Record<string, string | null>[] {
  const lignes: Record<string, string | null>[] = []
  for (const m of essai.matchAll(new RegExp(String.raw`insert into ${table} \(([^)]*)\) values([\s\S]*?)\$q\$`, 'g'))) {
    const colonnes = m[1].split(',').map((c) => c.trim())
    for (const t of m[2].matchAll(/\(([^()]*)\)/g)) {
      const valeurs = t[1].split(',').map((v) => v.trim())
      expect(valeurs, `${table} : ${t[1]}`).toHaveLength(colonnes.length)
      lignes.push(Object.fromEntries(colonnes.map((c, i) => {
        const v = valeurs[i]
        return [c, v === 'null' ? null : v.replace(/^'\{?|\}?'$/g, '')]
      })))
    }
  }
  return lignes
}

// Le jeu de l'essai : chaque échéance avec ses montants, et le modèle comptable de son dossier.
function jeuDeLEssai(essai: string): Map<string, { cotisation: CotisationDeclaree; modele: ModeleComptable }> {
  const dossiers = new Map(lignesInserees(essai, 'dossiers').map((d) => [d.id!, d]))
  const jeu = new Map<string, { cotisation: CotisationDeclaree; modele: ModeleComptable }>()
  for (const c of lignesInserees(essai, 'cotisations_declarees')) {
    if (!c.id) continue
    const d = dossiers.get(c.dossier_id!)
    const nombre = (v: string | null | undefined) => (v == null ? null : Number(v))
    jeu.set(c.id, {
      cotisation: cotisation({
        id: c.id, dossier_id: c.dossier_id!, echeance: c.echeance!, montant_appele: Number(c.montant_appele),
        montant_verse: nombre(c.montant_verse), montant_csg_crds: nombre(c.montant_csg_crds),
      }),
      modele: d
        ? { mode: d.mode_comptable as ModeleComptable['mode'], compteNotesDeFrais: d.compte_notes_de_frais as CompteNotesDeFrais }
        : TRESORERIE,
    })
  }
  return jeu
}

// Les déclarations de l'essai : l'échéance, et l'écriture envoyée — telle que la base l'a acceptée ou refusée.
function declarationsDe(essai: string): (Etape & { echeance: string; lignes: { compte: string; sens: string; montant: number }[] })[] {
  return etapesDe(essai).flatMap((e) => {
    const m = /^select enregistrer_paiement_personnel_cotisation\('\{\w+\}', '\{(\w+)\}', (?:'[\w-]+'|'\{\w+\}'|null), '(.*)'::jsonb\)$/s.exec(e.appel)
    if (!m) return []
    const json: unknown = JSON.parse(m[2].replace(/''/g, "'"))
    if (!Array.isArray(json)) return []
    return [{ ...e, echeance: m[1], lignes: (json as { compte: string; sens: string; montant: number }[]).map(({ compte, sens, montant }) => ({ compte, sens, montant })) }]
  })
}

// Une écriture comme un multiensemble, comme la base la compare : compte, sens et montant en centimes ENTIERS — un montant
// qui n'est pas au centime n'égale aucun nombre de centimes, il garde sa valeur reçue.
const multiensemble = (lignes: readonly { compte: string; sens: string; montant: number }[]) =>
  lignes.map((l) => {
    const centimes = l.montant * 100
    const entier = Math.round(centimes)
    return `${l.compte}|${l.sens}|${Math.abs(centimes - entier) < 1e-6 ? entier : `${l.montant} €`}`
  }).sort()

// ── Les refus de la déclaration, confrontés au texte de la base ──────────────────────────────────────────────────

describe('enregistrer_paiement_personnel_cotisation — le module dit ce que la fonction refuse', () => {
  it('les mêmes messages, dans le même ordre', () => {
    const sql = sqlDeLaDeclaration()
    expect(messagesSql(sql)).toHaveLength(17)
    expect(REFUS_PAIEMENT_PERSONNEL.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(new Set(REFUS_PAIEMENT_PERSONNEL.map((r) => r.cle)).size).toBe(REFUS_PAIEMENT_PERSONNEL.length)
  })

  // LA BORNE DU HARNAIS : une confrontation qui ne saurait pas virer au rouge ne prouverait rien.
  it('vire au rouge sur une dérive plantée dans le texte de la fonction', () => {
    const sql = sqlDeLaDeclaration()
    const attendu = REFUS_PAIEMENT_PERSONNEL.map((r) => r.modele)
    const mot = sql.replace("'Une échéance de zéro euro n''a rien à payer.'", "'Une échéance nulle n''a rien à payer.'")
    expect(mot).not.toBe(sql)
    expect(messagesSql(mot)).not.toEqual(attendu)
    const a = "raise exception 'La date du paiement depuis le compte personnel est à renseigner.'"
    const b = "raise exception 'Un paiement ne se date pas avant l''an 2000.'"
    expect(sql).toContain(a)
    expect(sql).toContain(b)
    expect(messagesSql(sql.replace(a, '§').replace(b, a).replace('§', b))).not.toEqual(attendu)
  })

  it('les valeurs des messages sont écrites comme le module les écrit', () => {
    const MONTANT = (x: string) => `replace(to_char(${x}, 'FM999999999990.00'), '.', ',')`
    const attendus: Record<string, string[]> = {
      deja_payee: ["to_char(v_cotisation.paiement_personnel_le, 'DD/MM/YYYY')"],
      rapprochee: ["to_char(v_mouvement, 'DD/MM/YYYY')"],
      echeance_figee: ['public.exercice_fige(p_dossier_id, extract(year from v_cotisation.echeance)::integer)'],
      date_future: ["to_char(v_aujourd_hui, 'DD/MM/YYYY')"],
      date_figee: ['public.exercice_fige(p_dossier_id, extract(year from p_date_paiement)::integer)'],
      avant_ouverture: ["to_char(v_ouverture, 'DD/MM/YYYY')"],
      csg_depasse: [MONTANT('v_csg'), MONTANT('abs(v_montant)')],
      ecriture_differente: ['v_compte'],
      desequilibre: ['v_debit', 'v_credit'],
    }
    const args = argumentsSql(sqlDeLaDeclaration())
    expect(args).toHaveLength(REFUS_PAIEMENT_PERSONNEL.length)
    REFUS_PAIEMENT_PERSONNEL.forEach((r, i) => {
      expect(args[i], r.cle).toEqual(attendus[r.cle] ?? [])
      expect(r.modele.replace(/%%/g, '').split('%').length - 1, r.cle).toBe(args[i].length)
    })
  })

  // Les numéros de compte, les sens et les bornes : la base les vérifie EXACTEMENT, et un compte renommé d'un seul côté
  // ferait refuser chaque déclaration, sans que rien dise pourquoi.
  it('les comptes, les sens et les bornes sont ceux de la fonction', () => {
    const sql = sqlDeLaDeclaration()
    expect(sql).toContain(`('${COMPTE_COTISATIONS_EXPLOITANT}', v_sens_charge, v_net),`)
    expect(sql).toContain('(v_compte, v_sens_dirigeant, v_net)')
    expect(sql).toContain('where a.centimes > 0')
    expect(sql).toContain(`case when d.mode_comptable = 'engagement' then d.compte_notes_de_frais else '${COMPTE_EXPLOITANT}' end`)
    expect(sql).toContain("v_sens_charge := case when v_montant > 0 then 'debit' else 'credit' end")
    expect(sql).toContain("v_sens_dirigeant := case when v_montant > 0 then 'credit' else 'debit' end")
    expect(sql).toContain('v_montant := coalesce(v_cotisation.montant_verse, v_cotisation.montant_appele);')
    expect(sql).toContain("if v_mode = 'tresorerie' and v_cotisation.montant_csg_crds is not null then")
    expect(sql).toContain('v_net := (abs(v_montant) * 100)::bigint - (v_csg * 100)::bigint;')
    expect(sql).toContain("if p_date_paiement < date '2000-01-01' then")
    expect(sql).toContain("(now() at time zone 'Europe/Paris')::date")
    expect(sql).toContain('if v_ouverture is not null and p_date_paiement < v_ouverture then')
    expect(sql).toContain('if v_frontiere is not null and p_date_paiement <= v_frontiere then')
    expect(sql).toContain('if v_frontiere is not null and v_cotisation.echeance <= v_frontiere then')
  })

  it('l’écran envoie exactement les paramètres de la fonction', () => {
    const signature = /function public\.enregistrer_paiement_personnel_cotisation\(([^)]*)\)/.exec(sqlDeLaDeclaration())
    expect(signature).not.toBeNull()
    const parametres = (signature as RegExpExecArray)[1].split(',').map((p) => p.trim().split(/\s+/)[0])
    expect(Object.keys(argumentsDeLaDeclaration('d1', cotisation(), '2026-03-10', TRESORERIE))).toEqual(parametres)
  })
})

// ── refusPaiementPersonnel ──────────────────────────────────────────────────────────────────────────────────────────

describe('refusPaiementPersonnel — dit avant le clic ce que la base refuserait, sous ses mots', () => {
  it('rien à redire d’un appel payé de la poche de l’exploitant, à une date libre', () => {
    expect(refusPaiementPersonnel(cotisation(), '2026-03-10', contexte())).toBeNull()
    expect(refusPaiementPersonnel(cotisation(), AUJOURD_HUI, contexte())).toBeNull()
    expect(refusPaiementPersonnel(cotisation(), '2000-01-01', contexte())).toBeNull()
  })

  // Chaque cas porte TOUS les défauts qui suivent le sien : le premier rendu doit être le sien. Avec l'égalité des
  // listes ci-dessus, l'ordre de l'écran est celui des `raise` de la fonction.
  it('dans l’ordre de la fonction', () => {
    const fautes = {
      cotisation: cotisation({ paiement_personnel_le: '2026-01-10', echeance: '2025-12-05', montant_appele: 0 }),
      date: null as string | null,
      contexte: contexte({ mouvement: { date: '2025-12-05' }, anneesValidees: [2025], ouverture: '2026-02-01' }),
    }
    const vus: string[] = []
    const voir = () => vus.push(refusPaiementPersonnel(fautes.cotisation, fautes.date, fautes.contexte)?.cle ?? 'aucun')
    voir()
    fautes.cotisation = { ...fautes.cotisation, paiement_personnel_le: null }
    voir()
    fautes.contexte = { ...fautes.contexte, mouvement: null }
    voir()
    fautes.cotisation = { ...fautes.cotisation, echeance: '2026-03-05' }
    voir()
    fautes.date = '1999-12-31'
    voir()
    fautes.date = '2026-12-01'
    voir()
    fautes.date = '2025-12-28'
    voir()
    fautes.date = '2026-01-15'
    voir()
    fautes.date = '2026-03-10'
    voir()
    fautes.cotisation = { ...fautes.cotisation, montant_appele: 100.005 }
    voir()
    fautes.cotisation = { ...fautes.cotisation, montant_appele: 100, montant_csg_crds: 10.001 }
    voir()
    fautes.cotisation = { ...fautes.cotisation, montant_csg_crds: 150 }
    voir()
    fautes.cotisation = { ...fautes.cotisation, montant_csg_crds: 50 }
    voir()
    const dits = REFUS_PAIEMENT_PERSONNEL.map((r) => r.cle as string)
      .filter((c) => !['acces', 'echeance_introuvable', 'ecriture_illisible', 'ecriture_differente', 'desequilibre'].includes(c))
    expect(vus).toEqual([...dits, 'aucun'])
  })

  it('une date vide ou qui n’est pas une date civile est à renseigner — jamais proposée', () => {
    for (const date of [null, '', '10/03/2026', '2026-3-10']) {
      expect(refusPaiementPersonnel(cotisation(), date, contexte())?.cle, String(date)).toBe('date_absente')
    }
  })

  it('les bornes sont celles de la base : l’an 2000 compris, aujourd’hui compris, la frontière comprise', () => {
    expect(refusPaiementPersonnel(cotisation(), '1999-12-31', contexte())?.cle).toBe('date_avant_2000')
    expect(refusPaiementPersonnel(cotisation(), '2026-10-10', contexte())?.cle).toBe('date_future')
    const valide = contexte({ anneesValidees: [2025] })
    expect(refusPaiementPersonnel(cotisation(), '2025-12-31', valide)?.cle).toBe('date_figee')
    expect(refusPaiementPersonnel(cotisation(), '2026-01-01', valide)).toBeNull()
    const repris = contexte({ ouverture: '2026-01-01' })
    expect(refusPaiementPersonnel(cotisation(), '2025-12-31', repris)?.cle).toBe('avant_ouverture')
    expect(refusPaiementPersonnel(cotisation(), '2026-01-01', repris)).toBeNull()
  })

  it('l’échéance figée se dit par l’exercice qui la fige, comme la base', () => {
    const r = refusPaiementPersonnel(cotisation({ echeance: '2024-11-05' }), '2026-01-10', contexte({ anneesValidees: [2025] }))
    expect(r?.message).toBe("L'exercice 2024 est figé par la validation de l'exercice 2025 : cette échéance ne change plus.")
  })

  it('en engagement, la CSG-CRDS ne s’écrit pas à part : elle ne peut rien empêcher', () => {
    const engagement = contexte({ modele: ENGAGEMENT })
    expect(refusPaiementPersonnel(cotisation({ montant_appele: 100, montant_csg_crds: 150 }), '2026-03-10', engagement)).toBeNull()
    expect(refusPaiementPersonnel(cotisation({ montant_csg_crds: 10.001 }), '2026-03-10', engagement)).toBeNull()
    expect(refusPaiementPersonnel(cotisation({ montant_appele: 100, montant_csg_crds: 150 }), '2026-03-10', contexte())?.cle)
      .toBe('csg_depasse')
  })

  it('une CSG-CRDS égale à l’échéance est admise : il n’y a alors rien à écrire', () => {
    expect(refusPaiementPersonnel(cotisation({ montant_appele: 250, montant_csg_crds: 250 }), '2026-05-07', contexte())).toBeNull()
  })

  it('le versement saisi fait foi sur l’appel', () => {
    expect(refusPaiementPersonnel(cotisation({ montant_appele: 0, montant_verse: 480 }), '2026-03-10', contexte())).toBeNull()
    expect(refusPaiementPersonnel(cotisation({ montant_appele: 500, montant_verse: 0 }), '2026-03-10', contexte())?.cle)
      .toBe('echeance_nulle')
  })
})

// ── Les messages que la base a rendus, en production ───────────────────────────────────────────────────────────────

describe('refusPaiementPersonnel — les messages que l’essai a lus en base', () => {
  const jeu = jeuDeLEssai(ESSAI)
  const de = (id: string) => {
    const e = jeu.get(id)
    expect(e, id).toBeDefined()
    return e!
  }

  it('lit le jeu de l’essai : ses échéances et le modèle de leurs dossiers', () => {
    expect(jeu.size).toBeGreaterThanOrEqual(20)
    expect(de('C1').cotisation).toMatchObject({ echeance: '2026-03-05', montant_appele: 1000, montant_verse: null, montant_csg_crds: 300 })
    expect(de('C9').cotisation).toMatchObject({ montant_appele: 500, montant_verse: 480, montant_csg_crds: 48 })
    expect(de('CE').modele).toEqual(ENGAGEMENT)
    expect(de('C1').modele.mode).toBe('tresorerie')
  })

  it('chaque refus que l’écran peut dire, au mot et à la valeur près', () => {
    const C = (id: string, o: Partial<CotisationDeclaree> = {}) => ({ ...de(id).cotisation, ...o })
    const dit = (c: CotisationDeclaree, date: string | null, o: Partial<ContextePaiementPersonnel> = {}) =>
      refusPaiementPersonnel(c, date, contexte(o))?.message
    commeLaBase(ESSAI, '15', dit(C('C1', { paiement_personnel_le: '2026-03-10' }), '2026-03-11'))
    commeLaBase(ESSAI, '16', dit(C('CR'), '2026-03-10', { mouvement: { date: '2026-03-05' } }))
    commeLaBase(ESSAI, '17', dit(C('C4'), null))
    commeLaBase(ESSAI, '18', dit(C('C4'), '1999-12-31'))
    commeLaBase(ESSAI, '19', dit(C('C4'), '2026-10-10'))
    commeLaBase(ESSAI, '20', dit(C('CO'), '2024-12-20', { ouverture: '2025-01-01' }))
    commeLaBase(ESSAI, '21', dit(C('C5'), '2026-01-05'))
    commeLaBase(ESSAI, '22', dit(C('C6'), '2026-01-06'))
    commeLaBase(ESSAI, '23', dit(C('C7'), '2026-01-07'))
    commeLaBase(ESSAI, '24', dit(C('C8'), '2026-01-08'))
    commeLaBase(ESSAI, '79', dit(C('CV3'), '2026-01-15', { anneesValidees: [2025] }))
    commeLaBase(ESSAI, '79b', dit(C('CV3'), null, { anneesValidees: [2025] }))
    commeLaBase(ESSAI, '80', dit(C('CV5'), '2025-12-28', { anneesValidees: [2025] }))
    // Et l'engagement admet ce que la trésorerie refuse (contrôle 25 : accepté).
    expect(etape(ESSAI, '25').code).toBe('OK')
    expect(refusPaiementPersonnel(de('CE2').cotisation, '2026-03-12', contexte({ modele: de('CE2').modele }))).toBeNull()
  })

  it('ceux que l’écran ne peut pas dire ont les mots de la base', () => {
    const modele = (cle: string) => REFUS_PAIEMENT_PERSONNEL.find((r) => r.cle === cle)!.modele
    commeLaBase(ESSAI, '2', modele('acces'))
    commeLaBase(ESSAI, '3', modele('acces'))
    commeLaBase(ESSAI, '14', modele('echeance_introuvable'))
    commeLaBase(ESSAI, '26', modele('ecriture_illisible'))
    commeLaBase(ESSAI, '29', remplirModele(modele('ecriture_differente'), [COMPTE_EXPLOITANT]))
    commeLaBase(ESSAI, '35', remplirModele(modele('ecriture_differente'), [ENGAGEMENT.compteNotesDeFrais]))
  })
})

// ── L'écriture ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('ecritureDuPaiementPersonnel — la cotisation hors CSG-CRDS au 646000, face au compte du dirigeant', () => {
  it('en trésorerie : la CSG-CRDS se compense sur le 108000, l’écriture garde le solde', () => {
    expect(ecritureDuPaiementPersonnel(cotisation(), TRESORERIE).map(({ compte, sens, montant }) => [compte, sens, montant])).toEqual([
      [COMPTE_COTISATIONS_EXPLOITANT, 'debit', 700],
      [COMPTE_EXPLOITANT, 'credit', 700],
    ])
  })

  it('en engagement : toute l’échéance au 646000, face au compte choisi pour le dirigeant', () => {
    for (const compteNotesDeFrais of ['455000', '467000', '108000'] as const) {
      const lignes = ecritureDuPaiementPersonnel(cotisation(), { mode: 'engagement', compteNotesDeFrais })
      expect(lignes.map(({ compte, sens, montant }) => [compte, sens, montant])).toEqual([
        [COMPTE_COTISATIONS_EXPLOITANT, 'debit', 1000],
        [compteNotesDeFrais, 'credit', 1000],
      ])
    }
  })

  it('un remboursement reçu sur le compte personnel : les sens s’inversent, la CSG-CRDS saisie en négatif aussi', () => {
    const lignes = ecritureDuPaiementPersonnel(cotisation({ montant_appele: -120, montant_csg_crds: -11.64 }), TRESORERIE)
    expect(lignes.map(({ compte, sens, montant }) => [compte, sens, montant])).toEqual([
      [COMPTE_COTISATIONS_EXPLOITANT, 'credit', 108.36],
      [COMPTE_EXPLOITANT, 'debit', 108.36],
    ])
    expect(lignes[0].libelle).toBe('Remboursement de cotisation, échéance du 05/03/2026, reçu sur le compte personnel')
  })

  it('une échéance faite toute de CSG-CRDS ne laisse rien à écrire en trésorerie, tout en engagement', () => {
    const toute = cotisation({ montant_appele: 250, montant_csg_crds: 250 })
    expect(ecritureDuPaiementPersonnel(toute, TRESORERIE)).toEqual([])
    expect(ecritureDuPaiementPersonnel(toute, ENGAGEMENT).map((l) => l.montant)).toEqual([250, 250])
  })

  it('sans CSG-CRDS saisie, toute l’échéance ; le versement saisi fait foi sur l’appel', () => {
    expect(ecritureDuPaiementPersonnel(cotisation({ montant_csg_crds: null }), TRESORERIE).map((l) => l.montant)).toEqual([1000, 1000])
    expect(ecritureDuPaiementPersonnel(cotisation({ montant_appele: 500, montant_verse: 480, montant_csg_crds: 48 }), TRESORERIE)
      .map((l) => l.montant)).toEqual([432, 432])
  })

  it('compte en centimes : la différence tombe juste', () => {
    // 0,1 + 0,2 en virgule flottante ne vaut pas 0,3 : en centimes, si.
    expect(ecritureDuPaiementPersonnel(cotisation({ montant_appele: 0.3, montant_csg_crds: 0.1 }), TRESORERIE).map((l) => l.montant))
      .toEqual([0.2, 0.2])
    expect(ecritureDuPaiementPersonnel(cotisation({ montant_appele: 1234.57, montant_csg_crds: 117.29 }), TRESORERIE).map((l) => l.montant))
      .toEqual([1117.28, 1117.28])
  })

  it('porte le libellé que le FEC reprend', () => {
    expect(libelleDuPaiementPersonnel(cotisation())).toBe('Cotisation, échéance du 05/03/2026, payée depuis le compte personnel')
    expect(ecritureDuPaiementPersonnel(cotisation(), TRESORERIE).every((l) => l.libelle === libelleDuPaiementPersonnel(cotisation()))).toBe(true)
  })

  // LA CONFRONTATION QUI COMPTE : chaque déclaration que la base a ACCEPTÉE dans l'essai porte exactement l'écriture que
  // le module compose pour la même échéance, dans le même dossier ; chaque écriture qu'elle a refusée comme « ne
  // correspond pas » en diffère.
  it('est celle que la base a acceptée dans l’essai, et pas une de celles qu’elle a refusées', () => {
    const jeu = jeuDeLEssai(ESSAI)
    const declarations = declarationsDe(ESSAI)
    const acceptees = declarations.filter((d) => d.code === 'OK')
    const refusees = declarations.filter((d) => d.attendu.startsWith("L'écriture proposée ne correspond pas"))
    // Un plancher : un motif d'extraction qui ne lirait plus rien rendrait ce test aveugle, pas vert.
    expect(acceptees.length).toBeGreaterThanOrEqual(10)
    expect(refusees.length).toBeGreaterThanOrEqual(8)
    for (const d of acceptees) {
      const { cotisation: c, modele } = jeu.get(d.echeance)!
      expect(multiensemble(ecritureDuPaiementPersonnel(c, modele)), `${d.numero} (${d.echeance})`).toEqual(multiensemble(d.lignes))
    }
    for (const d of refusees) {
      const { cotisation: c, modele } = jeu.get(d.echeance)!
      expect(multiensemble(ecritureDuPaiementPersonnel(c, modele)), `${d.numero} (${d.echeance})`).not.toEqual(multiensemble(d.lignes))
    }
  })
})

// ── La confirmation et ce que l'écran envoie ───────────────────────────────────────────────────────────────────────

describe('confirmationPaiementPersonnel — nomme ce qui s’écrit', () => {
  it('l’échéance, la date, l’écriture et l’exercice de la 2035 où elle comptera', () => {
    const texte = confirmationPaiementPersonnel(cotisation(), '2026-03-10', TRESORERIE)
    expect(texte).toContain(`Déclarer l'échéance du 05/03/2026 (${formatMoney(1000)}) payée depuis le compte personnel de l'exploitant, le 10/03/2026.`)
    expect(texte).toContain(`Le brouillon reçoit ${formatMoney(700)} au débit du 646000, face au 108000, à cette date.`)
    expect(texte).toContain("L'échéance compte ce jour-là dans la 2035 de 2026.")
    // Ce qui défera le paiement : la confirmation ne promet pas un retrait que la base n'offre pas encore.
    expect(texte).toContain(RETRAIT_EXPORTE
      ? 'Ce paiement se retire tant que son exercice n’est pas validé.'
      : 'Ce paiement ne se retire pas seul : il part avec son échéance, quand on la retire, tant que son exercice n’est pas validé.')
  })

  it('la raison d’une écriture à reprendre ne conseille pas un retrait que la base n’offre pas encore', () => {
    expect(RAISON_ECRITURE_A_REPRENDRE).toBe(RETRAIT_EXPORTE
      ? "Son écriture manque ou ne suit plus l'échéance : retire le paiement, puis déclare-le de nouveau."
      : "Son écriture manque ou ne suit plus l'échéance : retire l'échéance, qui emporte son paiement, puis saisis-la et déclare son paiement de nouveau.")
  })

  it('un remboursement se dit remboursement, au crédit du 646000', () => {
    const texte = confirmationPaiementPersonnel(cotisation({ montant_appele: -120, montant_csg_crds: -11.64, echeance: '2026-04-05' }), '2026-04-12', TRESORERIE)
    expect(texte).toContain(`Déclarer le remboursement de l'échéance du 05/04/2026 (${formatMoney(120)}) reçu sur le compte personnel de l'exploitant, le 12/04/2026.`)
    expect(texte).toContain(`Le brouillon reçoit ${formatMoney(108.36)} au crédit du 646000, face au 108000, à cette date.`)
  })

  it('une échéance toute de CSG-CRDS dit qu’il n’y a rien à écrire', () => {
    expect(confirmationPaiementPersonnel(cotisation({ montant_appele: 250, montant_csg_crds: 250 }), '2026-05-07', TRESORERIE))
      .toContain('Faite toute de CSG-CRDS, elle ne laisse rien à écrire au brouillon.')
  })

  // En engagement, la 2035 n'est pas produite : la confirmation ne la promet pas.
  it('en engagement, le compte du dirigeant du dossier et l’exercice, sans 2035', () => {
    const texte = confirmationPaiementPersonnel(cotisation(), '2026-03-10', { mode: 'engagement', compteNotesDeFrais: '467000' })
    expect(texte).toContain(`Le brouillon reçoit ${formatMoney(1000)} au débit du 646000, face au 467000, à cette date.`)
    expect(texte).toContain("L'échéance compte ce jour-là dans l'exercice 2026.")
    expect(texte).not.toContain('2035')
  })

  it('l’écran envoie le dossier, l’échéance, la date saisie et l’écriture composée ici', () => {
    expect(argumentsDeLaDeclaration('d1', cotisation(), '2026-03-10', TRESORERIE)).toEqual({
      p_dossier_id: 'd1', p_cotisation_id: 'c1', p_date_paiement: '2026-03-10',
      p_ecritures: ecritureDuPaiementPersonnel(cotisation(), TRESORERIE),
    })
  })
})

// ── Les paiements dont l'écriture est à reprendre ──────────────────────────────────────────────────────────────────

describe('paiementsPersonnelsAReprendre — défensif : la base écrit le paiement et son écriture ensemble', () => {
  const payee = cotisation({ paiement_personnel_le: '2026-03-10' })
  const reprendre = (ecritures: EcritureBrouillon[], cotisations: CotisationDeclaree[], modele = TRESORERIE, frontiere: string | null = null) =>
    paiementsPersonnelsAReprendre(ecritures, cotisations, modele, frontiere).map((p) => [p.cotisation.id, p.raison])

  it('se tait sur un paiement écrit comme il le produirait, dans n’importe quel ordre', () => {
    expect(reprendre(ECRITE, [payee])).toEqual([])
    expect(reprendre([...ECRITE].reverse(), [payee])).toEqual([])
  })

  it('un paiement sans écriture, ou dont l’écriture n’est plus celle qu’il produirait', () => {
    expect(reprendre([], [payee])).toEqual([['c1', RAISON_ECRITURE_A_REPRENDRE]])
    expect(reprendre([ECRITE[0]], [payee])).toEqual([['c1', RAISON_ECRITURE_A_REPRENDRE]])
    expect(reprendre(ECRITE.map((e) => ({ ...e, date: '2026-03-11' })), [payee])).toEqual([['c1', RAISON_ECRITURE_A_REPRENDRE]])
    expect(reprendre(ECRITE.map((e) => ({ ...e, montant: 650 })), [payee])).toEqual([['c1', RAISON_ECRITURE_A_REPRENDRE]])
    expect(reprendre([...ECRITE, ecriture({ id: 'e3', montant: 0.01 })], [payee])).toEqual([['c1', RAISON_ECRITURE_A_REPRENDRE]])
  })

  it('n’attribue à une échéance que les lignes qui la désignent', () => {
    const autre = ECRITE.map((e) => ({ ...e, cotisation_id: 'c2' }))
    expect(reprendre(autre, [payee])).toEqual([['c1', RAISON_ECRITURE_A_REPRENDRE]])
    expect(reprendre(ECRITE.map((e) => ({ ...e, cotisation_id: null })), [payee])).toEqual([['c1', RAISON_ECRITURE_A_REPRENDRE]])
  })

  it('une échéance toute de CSG-CRDS n’attend rien en trésorerie, et toute son écriture en engagement', () => {
    const toute = cotisation({ montant_appele: 250, montant_csg_crds: 250, paiement_personnel_le: '2026-05-07' })
    expect(reprendre([], [toute])).toEqual([])
    expect(reprendre([], [toute], ENGAGEMENT)).toEqual([['c1', RAISON_ECRITURE_A_REPRENDRE]])
  })

  it('un paiement qui ne peut pas s’écrire dit pourquoi', () => {
    const depasse = cotisation({ montant_appele: 100, montant_csg_crds: 150, paiement_personnel_le: '2026-03-10' })
    expect(reprendre([], [depasse])).toEqual([['c1', 'La CSG-CRDS de cette échéance (150,00 €) dépasse son montant (100,00 €).']])
  })

  it('ne dit rien d’une échéance sans paiement personnel, ni d’un paiement figé par la validation, frontière comprise', () => {
    expect(reprendre([], [cotisation()])).toEqual([])
    expect(reprendre([], [cotisation({ paiement_personnel_le: '2025-12-31' })], TRESORERIE, '2025-12-31')).toEqual([])
    expect(reprendre([], [cotisation({ paiement_personnel_le: '2026-01-01' })], TRESORERIE, '2025-12-31'))
      .toEqual([['c1', RAISON_ECRITURE_A_REPRENDRE]])
  })
})

// ── Le retrait ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('le retrait d’un paiement depuis le compte personnel', () => {
  it('les refus du module sont ceux que l’essai du retrait a lus en base', () => {
    const modele = (cle: string) => REFUS_RETRAIT_PAIEMENT_PERSONNEL.find((r) => r.cle === cle)!.modele
    commeLaBase(ESSAI_RETRAIT, '2', modele('acces'))
    commeLaBase(ESSAI_RETRAIT, '5', modele('echeance_introuvable'))
    commeLaBase(ESSAI_RETRAIT, '6', refusRetraitPaiementPersonnel(cotisation(), [])?.message)
    commeLaBase(ESSAI_RETRAIT, '7', refusRetraitPaiementPersonnel(
      cotisation({ echeance: '2025-03-05', paiement_personnel_le: '2025-03-10' }), [2025])?.message)
    commeLaBase(ESSAI_RETRAIT, '8', refusRetraitPaiementPersonnel(
      cotisation({ echeance: '2025-12-15', paiement_personnel_le: '2026-01-10' }), [2025])?.message)
    expect(etape(ESSAI_RETRAIT, '10').code).toBe('OK')
    expect(refusRetraitPaiementPersonnel(cotisation({ echeance: '2026-03-01', paiement_personnel_le: '2026-01-02' }), [2025])).toBeNull()
  })

  it('l’export porte la fonction du retrait si et seulement si RETRAIT_EXPORTE le dit — et alors, ses mots sont ceux du module', () => {
    const exportee = fichiersDuSchema().some((f) => /create (or replace )?function public\.retirer_paiement_personnel_cotisation\(/.test(f.texte))
    expect(exportee, 'RETRAIT_EXPORTE ne dit plus ce que porte l’export').toBe(RETRAIT_EXPORTE)
    if (!exportee) return
    const sql = derniereDefinitionSql('retirer_paiement_personnel_cotisation')
    expect(REFUS_RETRAIT_PAIEMENT_PERSONNEL.map((r) => r.modele)).toEqual(messagesSql(sql))
  })

  it('dans l’ordre de la fonction : le paiement, puis le paiement figé, puis l’échéance figée', () => {
    expect(refusRetraitPaiementPersonnel(cotisation({ echeance: '2024-12-05' }), [2025])?.cle).toBe('pas_payee')
    expect(refusRetraitPaiementPersonnel(cotisation({ echeance: '2024-12-05', paiement_personnel_le: '2025-12-31' }), [2025])?.cle)
      .toBe('paiement_fige')
    expect(refusRetraitPaiementPersonnel(cotisation({ echeance: '2025-12-31', paiement_personnel_le: '2026-01-01' }), [2025])?.cle)
      .toBe('echeance_figee')
    expect(refusRetraitPaiementPersonnel(cotisation({ echeance: '2026-01-01', paiement_personnel_le: '2026-01-01' }), [2025])).toBeNull()
    expect(refusRetraitPaiementPersonnel(cotisation({ echeance: '2024-12-05', paiement_personnel_le: '2025-01-10' }), [])).toBeNull()
  })

  it('la confirmation nomme le paiement, son écriture, et la date à laquelle l’échéance comptera', () => {
    expect(avertissementRetraitPaiementPersonnel(cotisation({ paiement_personnel_le: '2026-03-10' }), TRESORERIE, ECRITE)).toBe(
      `Le paiement du 10/03/2026 depuis le compte personnel est retiré. Son écriture (${formatMoney(700)} au 646000, face au 108000) `
      + 'est retirée du brouillon. L’échéance compte de nouveau à son échéance, le 05/03/2026, tant qu’aucun paiement ne la date.')
    // Toute de CSG-CRDS : rien d'écrit en trésorerie, et rien à retirer.
    expect(avertissementRetraitPaiementPersonnel(cotisation({ montant_appele: 250, montant_csg_crds: 250, paiement_personnel_le: '2026-05-07' }), TRESORERIE, []))
      .toContain('Il n’a aucune ligne au brouillon : rien n’en est retiré.')
  })

  // Le retrait est le geste conseillé à une écriture « À reprendre » : la confirmation dit les lignes que la fonction
  // retire — toutes celles qui désignent l'échéance, telles qu'elles sont —, jamais celles que le paiement produirait.
  it('la confirmation nomme les lignes TELLES QU’ELLES SONT au brouillon, et seulement celles de l’échéance', () => {
    const payee = cotisation({ paiement_personnel_le: '2026-03-10' })
    const avertir = (ecritures: EcritureBrouillon[] | null) => avertissementRetraitPaiementPersonnel(payee, TRESORERIE, ecritures)
    // Absente : rien n'est annoncé retiré.
    expect(avertir([])).toContain('Il n’a aucune ligne au brouillon : rien n’en est retiré.')
    expect(avertir(ECRITE.map((e) => ({ ...e, cotisation_id: 'c2' })))).toContain('Il n’a aucune ligne au brouillon : rien n’en est retiré.')
    // Différente : ses lignes, leurs comptes, et qu'elles ne suivent plus l'échéance.
    expect(avertir(ECRITE.map((e) => ({ ...e, montant: 650 })))).toContain(
      'Ses 2 lignes au brouillon (108000, 646000), qui ne suivent plus l’échéance, sont retirées.')
    expect(avertir(ECRITE.map((e) => ({ ...e, date: '2026-03-11' })))).toContain('qui ne suivent plus l’échéance, sont retirées.')
    expect(avertir([ECRITE[0]])).toContain('Sa ligne au brouillon (646000), qui ne suit plus l’échéance, est retirée.')
    expect(avertir([...ECRITE, ecriture({ id: 'e3', compte: '108000', montant: 0.01 })])).toContain(
      'Ses 3 lignes au brouillon (108000, 646000), qui ne suivent plus l’échéance, sont retirées.')
    // Juste, dans n'importe quel ordre, au milieu des lignes d'autres échéances.
    expect(avertir([ecriture({ id: 'x', cotisation_id: 'c2' }), ...[...ECRITE].reverse()])).toContain(
      `Son écriture (${formatMoney(700)} au 646000, face au 108000) est retirée du brouillon.`)
    // Lu en partie : rien de détaillé, seulement ce que la fonction fait.
    expect(avertir(null)).toBe('Le paiement du 10/03/2026 depuis le compte personnel est retiré. Ses lignes au brouillon sont '
      + 'retirées avec lui ; le brouillon n’a été lu qu’en partie, elles ne sont pas détaillées ici. L’échéance compte de nouveau '
      + 'à son échéance, le 05/03/2026, tant qu’aucun paiement ne la date.')
  })

  it('la confirmation de la suppression d’une échéance payée dit que son paiement part avec elle', () => {
    expect(avertissementSuppressionEcheancePayee(cotisation({ paiement_personnel_le: '2026-03-10' })))
      .toBe('Son paiement du 10/03/2026 depuis le compte personnel part avec elle, et son écriture est retirée du brouillon.')
    expect(avertissementSuppressionEcheancePayee(cotisation())).toBeNull()
  })
})

// LES DEUX COLONNES SONT OBLIGATOIRES DANS types.ts, nullables — un type décrit la table (CLAUDE.md). Facultatives, une
// fabrique les oubliait sans que rien le dise, et un appel de `refusRapprochementCotisation` sans la date du paiement
// personnel sautait son refus en silence. Ce garde vit au COMPILATEUR (`tsc -b` type-vérifie les tests) : redevenues
// facultatives, les deux directives ci-dessous n'auraient plus d'erreur à attendre, et le build tomberait (TS2578).
describe('les colonnes du paiement personnel sont obligatoires dans types.ts', () => {
  it('une échéance ou une écriture construite sans elles ne compile pas', () => {
    // @ts-expect-error — `paiement_personnel_le` manque : une échéance lue de la base le porte toujours.
    const echeance: CotisationDeclaree = {
      id: 'c', dossier_id: 'd', echeance: '2026-03-05', montant_appele: 1, montant_verse: null, montant_csg_crds: null,
      previsionnel: false, created_at: '2026-01-01T00:00:00Z',
    }
    // @ts-expect-error — `cotisation_id` manque : une écriture lue de la base le porte toujours.
    const ecriture: EcritureBrouillon = {
      id: 'e', dossier_id: 'd', piece_id: null, ligne_bancaire_id: null, date: '2026-03-05', compte: '646000', libelle: 'x',
      montant: 1, sens: 'debit', statut: 'proposee', created_at: '2026-01-01T00:00:00Z', immobilisation_id: null,
      vehicule_id: null, declaration_tva_id: null, ...NON_VALIDEE,
    }
    expect([echeance.paiement_personnel_le, ecriture.cotisation_id]).toEqual([undefined, undefined])
  })
})
