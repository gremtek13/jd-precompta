import { describe, expect, it } from 'vitest'
import {
  apresLaValidation, argumentsDeJustifierSolde, centimesDuSoldeAnnonce, chaineDesDecisions, citationQuiGarde,
  decisionDeLaReprise, etatDeLExerciceEnRevision, etatDuSolde, ETATS_DU_SOLDE, messageDeLExercice, REFUS_JUSTIFIER_SOLDE,
  refusDeJustifierSolde, refusDuRetraitDUneSource, repriseProposee, revisionDeLExercice, soldeCommeLaBase,
  soldesDeLExercice, verifierCitation, type ArgumentsJustifierSolde, type ChaineDeDecisions, type CitationVerifiee,
  type ContexteDeJustification, type OuvertureLue,
} from './revision'
import { instantaneDeLaPreuve, preuveDuCompte } from './revisionPreuves'
import { soldeDuCompteCentimes } from './revisionSoldes'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import {
  aNouveau, bien, categorie, citation, decision, documentDivers, donnees, DOSSIER, ecriture, ecritureEquilibree, emprunt,
  nature, piece, soldeReporte,
} from '../test/revision'
import { derniereDefinitionSql } from '../test/schema'

// Des lettres dans chaque identifiant : un uuid fait de chiffres seuls se lit pareil en capitales, et les cas qui le
// mettent en capitales ne prouveraient rien.
const UUID = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`

it('les identifiants du jeu portent des lettres, que les capitales changent', () => {
  expect(UUID(1).toUpperCase()).not.toBe(UUID(1))
})

// ── Les soldes de l'exercice ──────────────────────────────────────────────────────────────────────────────────────

describe('les soldes de l’exercice, comptés comme la base les compte', () => {
  // Un brouillon tiré au hasard (`tirage`, une graine fixe) sur trois exercices, sept comptes, des montants au millième —
  // ceux que la base ne contraint pas au centime — et une ouverture reprise et reportée : chaque solde du lot doit être
  // celui de `soldeDuCompteCentimes`, que la table relevée sur `solde_du_compte` éprouve (revisionSoldes.test.ts).
  it('chaque solde du lot est celui de soldeDuCompteCentimes, au centime', () => {
    const suivant = tirage(20261009)
    const comptes = ['512000', '580000', '101000', '108000', '164000', '706000', '606100']
    const dates = ['2024-12-31', '2025-01-01', '2025-06-15', '2025-12-31', '2026-01-01']
    const ecritures = Array.from({ length: 600 }, (_, i) => ecriture({
      id: `e${i}`, compte: comptes[entierTire(suivant, comptes.length)], date: dates[entierTire(suivant, dates.length)],
      sens: entierTire(suivant, 2) === 0 ? 'debit' : 'credit', montant: (1 + entierTire(suivant, 2_000_000)) / 1000,
    }))
    const reprise = [aNouveau({ id: 'a1', date: '2025-01-01', compte: '512000', montant: 0.125 }), aNouveau({ id: 'a2', date: '2024-01-01', compte: '512000', montant: 7 })]
    const reportes = [soldeReporte({ id: 's1', date: '2025-01-01', compte: '101000', sens: 'credit', montant: 1.005 }), soldeReporte({ id: 's2', date: '2026-01-01', compte: '512000', montant: 9 })]
    const d = { ecritures, reprise, reportes }
    const soldes = soldesDeLExercice(2025, d)
    for (const compte of comptes) expect(soldes.get(compte) ?? 0, compte).toBe(soldeDuCompteCentimes(compte, 2025, d))
    expect([...soldes.keys()].sort()).toEqual([...comptes].sort())
  })

  it('un compte qu’une ligne porte reste dans la liste, soldé ou non', () => {
    const soldes = soldesDeLExercice(2025, { ecritures: ecritureEquilibree('x', '2025-03-01', '580000', '512000', 10).concat(ecritureEquilibree('y', '2025-04-01', '512000', '580000', 10)), reprise: [], reportes: [] })
    expect(soldes.get('580000')).toBe(0)
    expect(soldes.get('512000')).toBe(0)
  })
})

// ── L'exercice ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('l’exercice pour la révision, dans l’ordre des refus de la base', () => {
  const rien: OuvertureLue = { reprise: [], reportes: [], anneesValidees: [], ecritures: [] }

  it('hors des bornes, en cours, antérieur à la reprise, en attente, ou révisable', () => {
    expect(etatDeLExerciceEnRevision(1999, 2026, rien)).toEqual({ type: 'invalide' })
    expect(etatDeLExerciceEnRevision(2101, 2026, rien)).toEqual({ type: 'invalide' })
    // Les bornes elles-mêmes sont admises, comme en base (`p_annee < 2000 or p_annee > 2100`).
    expect(etatDeLExerciceEnRevision(2000, 2026, rien)).toEqual({ type: 'revisable' })
    expect(etatDeLExerciceEnRevision(2100, 2026, rien)).toEqual({ type: 'en-cours' })
    expect(etatDeLExerciceEnRevision(2026, 2026, rien)).toEqual({ type: 'en-cours' })
    expect(etatDeLExerciceEnRevision(2027, 2026, rien)).toEqual({ type: 'en-cours' })
    expect(etatDeLExerciceEnRevision(2025, 2026, { ...rien, reprise: [aNouveau({ date: '2026-01-01' })] })).toEqual({ type: 'anterieur-a-la-reprise' })
    expect(etatDeLExerciceEnRevision(2025, 2026, { ...rien, ecritures: [ecriture({ date: '2024-06-01' })] })).toEqual({ type: 'en-attente', exercice: 2024 })
    expect(etatDeLExerciceEnRevision(2025, 2026, { ...rien, ecritures: [ecriture({ date: '2024-06-01' })], anneesValidees: [2024] })).toEqual({ type: 'revisable' })
    expect(etatDeLExerciceEnRevision(2025, 2026, rien)).toEqual({ type: 'revisable' })
  })

  it('l’exercice en cours l’emporte sur l’ouverture, comme le refus 3 sur le refus 7', () => {
    expect(etatDeLExerciceEnRevision(2026, 2026, { ...rien, ecritures: [ecriture({ date: '2024-06-01' })] })).toEqual({ type: 'en-cours' })
  })

  it('dit la phrase de la base quand l’exercice ne se révise pas', () => {
    expect(messageDeLExercice(2025, { type: 'revisable' })).toBeNull()
    expect(messageDeLExercice(1999, { type: 'invalide' })).toBe('Exercice invalide.')
    expect(messageDeLExercice(2026, { type: 'en-cours' })).toBe("L'exercice 2026 n'est pas terminé : ses soldes se justifient une fois clos.")
    expect(messageDeLExercice(2025, { type: 'anterieur-a-la-reprise' })).toBe("L'exercice 2025 précède la reprise du dossier : il est dans les comptes repris.")
    expect(messageDeLExercice(2025, { type: 'en-attente', exercice: 2024 })).toBe("L'exercice 2024 n'est pas validé : les soldes de 2025 ne sont pas encore définitifs.")
  })
})

// ── La chaîne des décisions ───────────────────────────────────────────────────────────────────────────────────────

describe('la chaîne des décisions d’un compte', () => {
  const d1 = decision({ id: UUID(1), cree_le: '2026-02-01T10:00:00+00:00' })
  const d2 = decision({ id: UUID(2), remplace_id: UUID(1), cree_le: '2026-02-02T10:00:00+00:00' })
  const d3 = decision({ id: UUID(3), remplace_id: UUID(2), cree_le: '2026-01-01T10:00:00+00:00' })

  it('sans décision : rien, et lisible', () => {
    expect(chaineDesDecisions([], 2025, '512000')).toEqual({ decisions: [], courante: null, lisible: true })
  })

  it('suit les remplacements, quel que soit l’ordre lu et l’horodatage : la chaîne est l’ordre', () => {
    const c = chaineDesDecisions([d3, d1, d2, decision({ id: UUID(9), compte: '401000' }), decision({ id: UUID(8), annee: 2024 })], 2025, '512000')
    expect(c.lisible).toBe(true)
    expect(c.decisions.map((j) => j.id)).toEqual([UUID(1), UUID(2), UUID(3)])
    expect(c.courante?.id).toBe(UUID(3))
  })

  it('lit un identifiant en capitales comme la base lit un uuid', () => {
    const c = chaineDesDecisions([d1, { ...d2, remplace_id: UUID(1).toUpperCase() }], 2025, '512000')
    expect(c.courante?.id).toBe(UUID(2))
    const enCapitales = chaineDesDecisions([{ ...d1, id: UUID(1).toUpperCase() }, d2], 2025, '512000')
    expect(enCapitales.courante?.id).toBe(UUID(2))
  })

  it('une chaîne qui ne se suit pas n’a pas de courante : deux premières, deux suites, un maillon manquant', () => {
    const deuxPremieres = chaineDesDecisions([d1, decision({ id: UUID(4) })], 2025, '512000')
    expect(deuxPremieres).toMatchObject({ lisible: false, courante: null })
    expect(chaineDesDecisions([d1, d2, decision({ id: UUID(5), remplace_id: UUID(1) })], 2025, '512000').lisible).toBe(false)
    const orpheline = chaineDesDecisions([d1, d3], 2025, '512000')
    expect(orpheline).toMatchObject({ lisible: false, courante: null })
    // Illisible, elle se montre dans l'ordre de création — l'horodatage, puis l'identifiant.
    expect(orpheline.decisions.map((j) => j.id)).toEqual([UUID(3), UUID(1)])
    // Une boucle — la même décision lue deux fois — ne se suit pas sans fin.
    const boucle = chaineDesDecisions([d1, decision({ id: UUID(6), remplace_id: UUID(1) }), decision({ id: UUID(6), remplace_id: UUID(6) })], 2025, '512000')
    expect(boucle).toMatchObject({ lisible: false, courante: null })
  })
})

// ── Les citations et l'état d'un solde ────────────────────────────────────────────────────────────────────────────

describe('ce qu’une citation prouve encore', () => {
  const h = 'ab'.repeat(32)
  const pieces = new Map([['p1', { storage_hash: h }], ['p2', { storage_hash: 'cd'.repeat(32) }], ['p3', { storage_hash: null }], ['p4', { storage_hash: h.toUpperCase() }]])
  const documents = new Map([['d1', { storage_hash: h }]])

  it('intacte, changée, disparue, sans empreinte, introuvable', () => {
    expect(verifierCitation(citation({ piece_id: 'p1', empreinte: h }), pieces, documents)).toMatchObject({ etat: 'intacte', empreinteDuJour: h })
    expect(verifierCitation(citation({ document_id: 'd1', empreinte: h }), pieces, documents).etat).toBe('intacte')
    expect(verifierCitation(citation({ piece_id: 'p2', empreinte: h }), pieces, documents)).toMatchObject({ etat: 'changee', empreinteDuJour: 'cd'.repeat(32) })
    expect(verifierCitation(citation({ piece_id: 'p3', empreinte: h }), pieces, documents).etat).toBe('disparue')
    // Une empreinte en capitales n'est pas un SHA-256 en minuscules : la base ne l'aurait pas recopiée, l'écran ne la lit pas.
    expect(verifierCitation(citation({ piece_id: 'p4', empreinte: h }), pieces, documents).etat).toBe('disparue')
    expect(verifierCitation(citation({ piece_id: 'p3', empreinte: null }), pieces, documents).etat).toBe('sans-empreinte')
    expect(verifierCitation(citation({ piece_id: 'p1', empreinte: null }), pieces, documents)).toMatchObject({ etat: 'sans-empreinte', empreinteDuJour: h })
    expect(verifierCitation(citation({ piece_id: 'absente', empreinte: h }), pieces, documents).etat).toBe('introuvable')
    expect(verifierCitation(citation({ fichier_id: 'f1', empreinte: h }), pieces, documents).etat).toBe('introuvable')
    // Un identifiant se lit sans la casse, comme la base lit un uuid.
    expect(verifierCitation(citation({ piece_id: 'P1', empreinte: h }), pieces, documents).etat).toBe('intacte')
  })
})

describe('l’état d’un solde, déduit (conception, § 3.5)', () => {
  const vide: ChaineDeDecisions = { decisions: [], courante: null, lisible: true }
  const chaine = (j: Parameters<typeof decision>[0]): ChaineDeDecisions => {
    const courante = decision(j)
    return { decisions: [courante], courante, lisible: true }
  }
  const cite = (etat: CitationVerifiee['etat']): CitationVerifiee => ({ preuve: citation({}), etat, empreinteDuJour: null })

  it('chaque ligne du tableau', () => {
    expect(etatDuSolde({ revisable: false, soldeCentimes: 5, chaine: chaine({ solde: 0.05 }), citations: [] })).toEqual({ etat: 'en-attente', causes: [] })
    expect(etatDuSolde({ revisable: true, soldeCentimes: 0, chaine: vide, citations: [] })).toEqual({ etat: 'solde-nul', causes: [] })
    expect(etatDuSolde({ revisable: true, soldeCentimes: 5, chaine: vide, citations: [] })).toEqual({ etat: 'a-justifier', causes: [] })
    expect(etatDuSolde({ revisable: true, soldeCentimes: 5, chaine: chaine({ solde: 0.05, etat: 'justifie' }), citations: [cite('intacte'), cite('sans-empreinte')] }))
      .toEqual({ etat: 'justifie', causes: [] })
    expect(etatDuSolde({ revisable: true, soldeCentimes: 5, chaine: chaine({ solde: 0.05, etat: 'accepte' }), citations: [] })).toEqual({ etat: 'accepte', causes: [] })
    expect(etatDuSolde({ revisable: true, soldeCentimes: 5, chaine: chaine({ solde: 0.05, etat: 'anomalie' }), citations: [] })).toEqual({ etat: 'anomalie', causes: [] })
    expect(etatDuSolde({ revisable: true, soldeCentimes: 6, chaine: chaine({ solde: 0.05 }), citations: [] })).toEqual({ etat: 'a-revoir', causes: ['solde-change'] })
  })

  it('un exercice qui ne se révise pas l’emporte sur une chaîne illisible', () => {
    expect(etatDuSolde({ revisable: false, soldeCentimes: 0, chaine: { decisions: [], courante: null, lisible: false }, citations: [] }).etat).toBe('en-attente')
  })

  it('une décision dont un solde nul a été justifié reste justifiée', () => {
    expect(etatDuSolde({ revisable: true, soldeCentimes: 0, chaine: chaine({ solde: 0 }), citations: [] }).etat).toBe('justifie')
  })

  it('à revoir dès que la décision ne tient plus — une anomalie comprise —, avec chaque cause une fois', () => {
    expect(etatDuSolde({ revisable: true, soldeCentimes: 1, chaine: chaine({ solde: 0, etat: 'anomalie' }), citations: [] }).etat).toBe('a-revoir')
    expect(etatDuSolde({
      revisable: true, soldeCentimes: 1, chaine: chaine({ solde: 0 }),
      citations: [cite('changee'), cite('changee'), cite('disparue'), cite('introuvable'), cite('intacte')],
    }).causes).toEqual(['solde-change', 'empreinte-changee', 'empreinte-disparue', 'source-introuvable'])
    expect(etatDuSolde({ revisable: true, soldeCentimes: 0, chaine: chaine({ solde: 0, etat: 'accepte' }), citations: [cite('disparue')] }))
      .toEqual({ etat: 'a-revoir', causes: ['empreinte-disparue'] })
    expect(etatDuSolde({ revisable: true, soldeCentimes: 0, chaine: chaine({ solde: 0 }), citations: [cite('introuvable')] }))
      .toEqual({ etat: 'a-revoir', causes: ['source-introuvable'] })
    expect(etatDuSolde({ revisable: true, soldeCentimes: 0, chaine: { decisions: [], courante: null, lisible: false }, citations: [] }))
      .toEqual({ etat: 'a-revoir', causes: ['chaine-illisible'] })
  })

  it('un solde décidé au centime se compare en centimes, comme la base l’a écrit', () => {
    expect(etatDuSolde({ revisable: true, soldeCentimes: 103425, chaine: chaine({ solde: 1034.25 }), citations: [] }).etat).toBe('justifie')
    expect(etatDuSolde({ revisable: true, soldeCentimes: -30, chaine: chaine({ solde: -0.3 }), citations: [] }).etat).toBe('justifie')
    // 0,29 × 100 vaut 28,999… en virgule flottante : arrondi, pas tronqué.
    expect(etatDuSolde({ revisable: true, soldeCentimes: 29, chaine: chaine({ solde: 0.29 }), citations: [] }).etat).toBe('justifie')
  })

  it('après la validation : une décision prise après l’instant de la validation de son exercice', () => {
    expect(apresLaValidation(decision({ cree_le: '2026-03-01T10:00:00.123456+00:00' }), '2026-03-01T09:59:59+00:00')).toBe(true)
    expect(apresLaValidation(decision({ cree_le: '2026-03-01T09:00:00+00:00' }), '2026-03-01T09:59:59+00:00')).toBe(false)
    expect(apresLaValidation(decision({}), null)).toBe(false)
    expect(apresLaValidation(decision({ cree_le: '2026-03-01T09:59:59+00:00' }), '2026-03-01T09:59:59+00:00')).toBe(false)
    // Le décalage horaire compte : 10 h 30 à Paris l'été est 8 h 30 en temps universel.
    expect(apresLaValidation(decision({ cree_le: '2026-07-01T10:30:00+02:00' }), '2026-07-01T09:00:00+00:00')).toBe(false)
  })
})

// ── Les refus de justifier_solde, confrontés au texte de la fonction ──────────────────────────────────────────────

// Les messages des `raise exception` d'une fonction, dans l'ordre du texte, l'apostrophe doublée de SQL rendue simple.
function messagesSql(sql: string): string[] {
  return [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
}
// Le numéro de chaque `raise exception`, dans le même ordre : le dernier commentaire « -- N. » qui le précède ; « -- 6. et
// 7. » donne 6 au premier refus qui le suit, 7 au second.
function numerosSql(sql: string): number[] {
  const numeros: number[] = []
  let courants: number[] = []
  let rang = 0
  for (const m of sql.matchAll(/-- (\d+)\.(?: et (\d+)\.)?|raise exception/g)) {
    if (m[0] !== 'raise exception') {
      courants = m[2] === undefined ? [Number(m[1])] : [Number(m[1]), Number(m[2])]
      rang = 0
      continue
    }
    numeros.push(courants[Math.min(rang, courants.length - 1)])
    rang++
  }
  return numeros
}
// Le code de chaque `raise exception`, dans le même ordre.
function codesSql(sql: string): string[] {
  return [...sql.matchAll(/raise exception '(?:[^']|'')*'[\s\S]*?using errcode = '(\w+)'/g)].map((m) => m[1])
}
// Ce qui suit le message d'un `raise exception`, jusqu'à `using errcode` : les valeurs qui remplissent ses « % », coupées
// sur les virgules de premier niveau, hors chaînes.
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

describe('les refus de justifier_solde, tels que la migration les écrit', () => {
  const sql = derniereDefinitionSql('justifier_solde')

  it('les mêmes messages, dans le même ordre', () => {
    expect(messagesSql(sql)).toHaveLength(26)
    expect(REFUS_JUSTIFIER_SOLDE.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(new Set(REFUS_JUSTIFIER_SOLDE.map((r) => r.cle)).size).toBe(REFUS_JUSTIFIER_SOLDE.length)
  })

  it('les mêmes codes : 42501 pour l’accès, 22023 pour les autres', () => {
    const codes = codesSql(sql)
    expect(codes).toHaveLength(REFUS_JUSTIFIER_SOLDE.length)
    REFUS_JUSTIFIER_SOLDE.forEach((r, i) => expect(codes[i], r.cle).toBe(r.cle === 'acces' ? '42501' : '22023'))
  })

  it('les numéros suivent l’ordre de la fonction, le refus 4 réservé à l’étape R9', () => {
    const numeros = REFUS_JUSTIFIER_SOLDE.map((r) => r.refus)
    expect([...new Set(numeros)]).toEqual([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b))
    // Chaque refus de la fonction se repère dans son texte par son numéro, en commentaire : « -- 9. ».
    for (const n of [1, 2, 3, 5, 8, 9, 10, 11, 12, 13]) expect(sql, String(n)).toMatch(new RegExp(`-- ${n}\\.`))
    // Et chacun porte le numéro que le texte lui donne.
    expect(numeros).toEqual(numerosSql(sql))
  })

  it('les valeurs des messages sont celles que le module écrit', () => {
    const SOLDE = "case when v_solde = 0 then 'est nul' else 'est de ' || replace(to_char(abs(v_solde), 'FM99999999999990.00'), '.', ',') || ' € au ' || case when v_solde > 0 then 'débit' else 'crédit' end end"
    const attendus: Record<string, string[]> = {
      exercice_en_cours: ['p_annee'],
      anterieur_a_la_reprise: ['p_annee'],
      ouverture_en_attente: ['p_annee - 1', 'p_annee'],
      solde_change: ['p_compte', 'p_annee', SOLDE],
      remplacement_hors_compte: ['p_compte', 'p_annee'],
      reprise_hors_compte: ['p_compte', 'p_annee - 1'],
      reprise_remplacee: ['p_annee - 1'],
    }
    const args = argumentsSql(sql)
    expect(args).toHaveLength(REFUS_JUSTIFIER_SOLDE.length)
    REFUS_JUSTIFIER_SOLDE.forEach((r, i) => {
      expect(args[i], r.cle).toEqual(attendus[r.cle] ?? [])
      expect(r.modele.replace(/%%/g, '').split('%').length - 1, r.cle).toBe(args[i].length)
    })
  })

  // LA BORNE DU HARNAIS : une confrontation qui ne saurait pas virer au rouge ne prouverait rien.
  it('vire au rouge sur une dérive plantée dans le texte de la fonction', () => {
    const attendu = REFUS_JUSTIFIER_SOLDE.map((r) => r.modele)
    const mot = sql.replace("'Une anomalie se motive.'", "'Une anomalie se justifie.'")
    expect(mot).not.toBe(sql)
    expect(messagesSql(mot)).not.toEqual(attendu)
    const a = "raise exception 'Une anomalie se motive.'"
    const b = "raise exception 'Un solde accepté sans pièce se motive.'"
    expect(sql).toContain(a)
    expect(sql).toContain(b)
    expect(messagesSql(sql.replace(a, '§').replace(b, a).replace('§', b))).not.toEqual(attendu)
    expect(messagesSql(sql.replace(b, `${b} using errcode = '22023'; end if; if false then raise exception 'Un refus de plus.'`))).not.toEqual(attendu)
  })

  it('les bornes et les blancs sont ceux de la fonction', () => {
    expect(sql).toContain('if p_annee is null or p_annee < 2000 or p_annee > 2100 then')
    expect(sql).toContain("if p_annee >= extract(year from (now() at time zone 'Europe/Paris'))::integer then")
    expect(sql).toContain('not (abs(p_solde) < 100000000000000) or p_solde <> round(p_solde, 2)')
    expect(sql).toContain("!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'")
    expect(sql).toContain("k.cle not in ('piece_id', 'document_id', 'precision')")
    expect(sql).toContain("coalesce(jsonb_typeof(e.v -> 'precision'), 'null') not in ('string', 'null')")
    expect(sql).toContain("v_preuves jsonb := coalesce(nullif(p_preuves, 'null'::jsonb), '[]'::jsonb);")
    expect(sql).toContain("v_preuve_application jsonb := nullif(p_preuve_application, 'null'::jsonb);")
    expect(sql).toContain("jsonb_typeof(v_preuve_application) <> 'object' or v_preuve_application = '{}'::jsonb")
    expect(sql).toContain("to_char(abs(v_solde), 'FM99999999999990.00')")
  })
})

// ── Les refus, cas par cas ────────────────────────────────────────────────────────────────────────────────────────

describe('ce que justifier_solde refuserait, dit avant le clic', () => {
  // A : l'exercice 2025 d'un dossier que rien ne précède ; la banque à 1 034,25 au débit, le fournisseur à 12,34 au crédit.
  const P1 = UUID(101)
  const P2 = UUID(102)
  const D1 = UUID(201)
  const contexte: ContexteDeJustification = {
    accesAuDossier: true, anneeCourante: 2026, reprise: [], reportes: [], anneesValidees: [],
    ecritures: [...ecritureEquilibree('h', '2025-02-01', '512000', '706000', 1034.25), ...ecritureEquilibree('f', '2025-05-01', '445660', '401000', 12.34)],
    decisions: [], pieces: [{ id: P1 }, { id: P2 }], documents: [{ id: D1 }],
  }
  const args = (o: Partial<ArgumentsJustifierSolde>): ArgumentsJustifierSolde => ({
    p_dossier_id: DOSSIER, p_annee: 2025, p_compte: '512000', p_solde: 1034.25, p_etat: 'justifie', p_motif: null,
    p_portee: 'exercice', p_preuves: [{ piece_id: P1 }], p_preuve_application: null, p_remplace_id: null, p_reprise_de: null, ...o,
  })
  const cle = (o: Partial<ArgumentsJustifierSolde>, c: Partial<ContexteDeJustification> = {}) =>
    refusDeJustifierSolde(args(o), { ...contexte, ...c })?.cle ?? null

  it('rien quand la base écrirait la décision', () => {
    expect(refusDeJustifierSolde(args({}), contexte)).toBeNull()
  })

  it('l’accès d’abord, en 42501, et nul autre refus ne dépend de qui clique', () => {
    expect(refusDeJustifierSolde(args({ p_annee: 1999 }), { ...contexte, accesAuDossier: false }))
      .toEqual({ cle: 'acces', refus: 1, code: '42501', message: 'Accès refusé à ce dossier.' })
    expect(refusDeJustifierSolde(args({ p_annee: 1999 }), contexte)).toMatchObject({ refus: 2, code: '22023', message: 'Exercice invalide.' })
  })

  it('l’exercice : hors des bornes, absent, NaN, en cours', () => {
    for (const p_annee of [1999, 2101, null, Number.NaN]) expect(cle({ p_annee }), String(p_annee)).toBe('exercice_invalide')
    expect(cle({ p_annee: 2000 })).not.toBe('exercice_invalide')
    // La borne haute aussi est admise : 2100 passe le refus 2, et tombe au refus 3.
    expect(cle({ p_annee: 2100 })).toBe('exercice_en_cours')
    expect(refusDeJustifierSolde(args({ p_annee: 2026 }), contexte)?.message)
      .toBe("L'exercice 2026 n'est pas terminé : ses soldes se justifient une fois clos.")
    expect(cle({ p_annee: 2025 }, { anneeCourante: 2025 })).toBe('exercice_en_cours')
  })

  it('le compte : de bilan, trois chiffres au moins, sans blanc', () => {
    for (const p_compte of ['601000', '801000', ' 512000', '512000\n', '51', null]) expect(cle({ p_compte }), String(p_compte)).toBe('compte_hors_bilan')
  })

  it('l’ouverture : antérieur à la reprise, puis en attente', () => {
    expect(refusDeJustifierSolde(args({}), { ...contexte, reprise: [aNouveau({ date: '2026-01-01' })] })?.message)
      .toBe("L'exercice 2025 précède la reprise du dossier : il est dans les comptes repris.")
    expect(refusDeJustifierSolde(args({}), { ...contexte, ecritures: [...contexte.ecritures, ecriture({ date: '2024-06-01' })] })?.message)
      .toBe("L'exercice 2024 n'est pas validé : les soldes de 2025 ne sont pas encore définitifs.")
  })

  it('l’état, la portée et le motif, dans cet ordre (hypothèse Q3)', () => {
    expect(cle({ p_etat: 'valide', p_portee: 'toujours' })).toBe('etat_invalide')
    expect(cle({ p_etat: null })).toBe('etat_invalide')
    expect(cle({ p_portee: 'toujours' })).toBe('portee_invalide')
    expect(cle({ p_portee: null })).toBe('portee_invalide')
    expect(cle({ p_etat: 'anomalie', p_motif: ' \t\n\r' })).toBe('anomalie_sans_motif')
    expect(cle({ p_etat: 'anomalie' })).toBe('anomalie_sans_motif')
    expect(cle({ p_etat: 'accepte' })).toBe('accepte_sans_motif')
    expect(cle({ p_etat: 'accepte', p_motif: '' })).toBe('accepte_sans_motif')
    expect(cle({ p_motif: '  ' })).toBe('motif_blanc')
    expect(cle({ p_motif: '' })).toBe('motif_blanc')
    // Une espace insécable, un saut de page : la base n'y voit pas un blanc (relevé en production).
    expect(cle({ p_etat: 'accepte', p_motif: '\u00a0' })).toBeNull()
    expect(cle({ p_etat: 'accepte', p_motif: '\f' })).toBeNull()
    expect(cle({ p_etat: 'accepte', p_motif: 'm'.repeat(4000) })).toBeNull()
    expect(cle({ p_etat: 'accepte', p_motif: 'm'.repeat(4001) })).toBe('motif_trop_long')
    // Des caractères comme la base les compte : quatre mille émojis tiennent, huit mille unités UTF-16.
    expect(cle({ p_etat: 'accepte', p_motif: '😀'.repeat(4000) })).toBeNull()
    expect(cle({ p_etat: 'accepte', p_motif: '😀'.repeat(4001) })).toBe('motif_trop_long')
  })

  it('le solde : au centime, puis celui des écritures, son côté dit comme la base le dit', () => {
    for (const p_solde of [null, 1034.255, Number.NaN, Number.POSITIVE_INFINITY, 1e14, -1e14, 0.1 + 0.2]) {
      expect(cle({ p_solde }), String(p_solde)).toBe('solde_illisible')
    }
    expect(refusDeJustifierSolde(args({ p_solde: 1034.24 }), contexte)?.message)
      .toBe('Le solde du compte 512000 a changé : au 31/12/2025, il est de 1034,25 € au débit.')
    expect(refusDeJustifierSolde(args({ p_compte: '401000', p_solde: 12.34 }), contexte)?.message)
      .toBe('Le solde du compte 401000 a changé : au 31/12/2025, il est de 12,34 € au crédit.')
    expect(refusDeJustifierSolde(args({ p_compte: '580000', p_solde: 1 }), contexte)?.message)
      .toBe('Le solde du compte 580000 a changé : au 31/12/2025, il est nul.')
    expect(cle({ p_compte: '401000', p_solde: -12.34 })).toBeNull()
    expect(cle({ p_compte: '580000', p_solde: 0 })).toBeNull()
  })

  it('le remplacement : une décision du compte, la courante, ou rien', () => {
    const premiere = decision({ id: UUID(1), compte: '512000' })
    const seconde = decision({ id: UUID(2), compte: '512000', remplace_id: UUID(1) })
    const autre = decision({ id: UUID(3), compte: '401000' })
    expect(cle({}, { decisions: [premiere] })).toBe('remplacement_perime')
    expect(cle({ p_remplace_id: UUID(1) }, { decisions: [premiere] })).toBeNull()
    expect(cle({ p_remplace_id: UUID(1).toUpperCase() }, { decisions: [premiere] })).toBeNull()
    expect(cle({ p_remplace_id: UUID(1) }, { decisions: [premiere, seconde] })).toBe('remplacement_perime')
    expect(cle({ p_remplace_id: UUID(2) }, { decisions: [premiere, seconde] })).toBeNull()
    expect(refusDeJustifierSolde(args({ p_remplace_id: UUID(3) }), { ...contexte, decisions: [premiere, autre] })?.message)
      .toBe("La décision à remplacer n'est pas une décision du compte 512000 pour l'exercice 2025.")
    expect(cle({ p_remplace_id: UUID(9) })).toBe('remplacement_hors_compte')
    // Une décision du même compte, d'un autre exercice, ne se remplace pas d'ici.
    expect(cle({ p_remplace_id: UUID(7) }, { decisions: [decision({ id: UUID(7), annee: 2024 })] })).toBe('remplacement_hors_compte')
  })

  it('la reprise : une décision du compte à l’exercice précédent, permanente, courante', () => {
    const permanente = decision({ id: UUID(11), annee: 2024, portee: 'permanente' })
    const ponctuelle = decision({ id: UUID(12), annee: 2024, compte: '401000', portee: 'exercice' })
    const remplacante = decision({ id: UUID(13), annee: 2024, portee: 'permanente', remplace_id: UUID(11) })
    expect(cle({ p_reprise_de: UUID(11) }, { decisions: [permanente] })).toBeNull()
    expect(cle({ p_reprise_de: UUID(11).toUpperCase() }, { decisions: [permanente] })).toBeNull()
    expect(refusDeJustifierSolde(args({ p_reprise_de: UUID(99) }), contexte)?.message)
      .toBe("Une reprise vise une décision du compte 512000 pour l'exercice 2024.")
    expect(cle({ p_reprise_de: UUID(14) }, { decisions: [decision({ id: UUID(14), annee: 2023, portee: 'permanente' })] })).toBe('reprise_hors_compte')
    expect(cle({ p_compte: '401000', p_solde: -12.34, p_reprise_de: UUID(12) }, { decisions: [ponctuelle] })).toBe('reprise_non_permanente')
    expect(refusDeJustifierSolde(args({ p_reprise_de: UUID(11) }), { ...contexte, decisions: [permanente, remplacante] })?.message)
      .toBe('La décision de 2024 reprise a été remplacée depuis : relire avant de la reprendre.')
  })

  it('les preuves illisibles, lues comme le jsonb les lit (relevé en production)', () => {
    const illisibles: unknown[] = [
      {}, '[]', [1], [null], [[P1]], [{ piece_id: P1, nom: 'x' }], [{ piece_id: P1, document_id: D1 }], [{ precision: 'x' }],
      [{ piece_id: 'abc' }], [{ piece_id: 12 }], [{ piece_id: true }], [{ document_id: { id: D1 } }], [{ piece_id: [P1] }],
      [{ piece_id: P1, precision: 5 }], [{ piece_id: '', document_id: D1 }], [{ piece_id: `{${P1}}` }],
      [{ piece_id: P1.replace(/-/g, '') }], [{ piece_id: `${P1} ` }], [{ piece_id: `${P1}\n` }], [{ fichier_id: P1 }],
    ]
    for (const p_preuves of illisibles) expect(cle({ p_preuves }), JSON.stringify(p_preuves)).toBe('preuves_illisibles')
    // Lisibles : une clé à null, un identifiant en capitales, une précision nulle, une clé `undefined` qui disparaît.
    for (const p_preuves of [[{ piece_id: null, document_id: D1 }], [{ piece_id: P1.toUpperCase() }], [{ piece_id: P1, precision: null }], [{ piece_id: P1, document_id: undefined }]]) {
      expect(cle({ p_preuves }), JSON.stringify(p_preuves)).toBeNull()
    }
  })

  it('la précision, la source citée deux fois, la source d’un autre dossier, dans cet ordre', () => {
    expect(cle({ p_preuves: [{ piece_id: P1, precision: ' \n ' }, { piece_id: 'x' }] })).toBe('preuves_illisibles')
    expect(cle({ p_preuves: [{ piece_id: P1, precision: ' \n ' }, { piece_id: P1 }] })).toBe('precision_blanche')
    expect(cle({ p_preuves: [{ piece_id: P1, precision: '' }] })).toBe('precision_blanche')
    expect(cle({ p_preuves: [{ piece_id: P1, precision: '\u00a0' }] })).toBeNull()
    expect(cle({ p_preuves: [{ piece_id: P1, precision: '\f' }] })).toBeNull()
    expect(cle({ p_preuves: [{ piece_id: P1, precision: '😀'.repeat(500) }] })).toBeNull()
    expect(cle({ p_preuves: [{ piece_id: P1, precision: 'p'.repeat(501) }, { piece_id: P1 }] })).toBe('precision_trop_longue')
    expect(cle({ p_preuves: [{ piece_id: P1 }, { piece_id: P1.toUpperCase(), precision: 'x' }] })).toBe('source_en_double')
    expect(cle({ p_preuves: [{ document_id: D1 }, { document_id: D1 }] })).toBe('source_en_double')
    // Une pièce et un document du même identifiant ne sont pas la même source.
    expect(cle({ p_preuves: [{ piece_id: D1 }, { document_id: D1 }] }, { pieces: [{ id: D1 }] })).toBeNull()
    expect(cle({ p_preuves: [{ piece_id: P1 }, { piece_id: UUID(999) }] })).toBe('source_hors_dossier')
    expect(cle({ p_preuves: [{ document_id: P1 }] })).toBe('source_hors_dossier')
    expect(cle({ p_preuves: [{ piece_id: D1 }] })).toBe('source_hors_dossier')
  })

  it('l’instantané : un objet non vide, de 64 Kio au plus de son texte jsonb', () => {
    for (const p_preuve_application of [{}, [], 'texte', 5, [{ a: 1 }], { a: undefined }]) {
      expect(cle({ p_preuve_application }), JSON.stringify(p_preuve_application)).toBe('preuve_application_illisible')
    }
    // `{"x": "…"}` : neuf octets autour de la chaîne.
    expect(cle({ p_preuve_application: { x: 'x'.repeat(65527) } })).toBeNull()
    expect(cle({ p_preuve_application: { x: 'x'.repeat(65528) } })).toBe('preuve_application_illisible')
    // Mesuré sur le texte du jsonb, pas sur celui de JSON.stringify : 1e-7 s'y écrit 0.0000001, et « , » et « : » y
    // prennent une espace — huit octets de plus ici.
    const pres = { x: 'x'.repeat(65515), n: 1e-7 }
    expect(JSON.stringify(pres).length).toBeLessThanOrEqual(65536)
    expect(cle({ p_preuve_application: pres })).toBe('preuve_application_illisible')
    expect(cle({ p_preuve_application: null })).toBeNull()
    expect(cle({ p_preuve_application: undefined })).toBeNull()
  })

  it('un solde justifié cite quelque chose : une pièce, un document, ou la preuve de l’application', () => {
    expect(refusDeJustifierSolde(args({ p_preuves: [] }), contexte)?.message)
      .toBe("Un solde justifié cite au moins une pièce, un document ou la preuve de l'application.")
    expect(cle({ p_preuves: null })).toBe('justifie_sans_preuve')
    expect(cle({ p_preuves: undefined })).toBe('justifie_sans_preuve')
    expect(cle({ p_preuves: [], p_preuve_application: { version: 1 } })).toBeNull()
    expect(cle({ p_preuves: [], p_etat: 'accepte', p_motif: 'petit solde' })).toBeNull()
    expect(cle({ p_preuves: [], p_etat: 'anomalie', p_motif: 'écart inexpliqué' })).toBeNull()
  })
})

// ── Les arguments que l'écran envoie ──────────────────────────────────────────────────────────────────────────────

describe('les arguments de justifier_solde', () => {
  it('les onze, nuls plutôt qu’absents, le solde en euros', () => {
    const a = argumentsDeJustifierSolde(DOSSIER, 2025, {
      compte: '512000', soldeCentimes: 103425, etat: 'justifie', motif: '  ', portee: 'exercice',
      sources: [{ pieceId: 'p1', documentId: null, precision: 'relevé de décembre' }, { pieceId: null, documentId: 'd1', precision: ' ' }],
      preuveApplication: null, remplaceId: null, repriseDe: null,
    })
    expect(Object.keys(a).sort()).toEqual(['p_annee', 'p_compte', 'p_dossier_id', 'p_etat', 'p_motif', 'p_portee', 'p_preuve_application', 'p_preuves', 'p_remplace_id', 'p_reprise_de', 'p_solde'])
    expect(Object.values(a).some((v) => v === undefined)).toBe(false)
    expect(a).toMatchObject({ p_dossier_id: DOSSIER, p_annee: 2025, p_compte: '512000', p_solde: 1034.25, p_etat: 'justifie', p_motif: null, p_portee: 'exercice' })
    expect(a.p_preuves).toEqual([{ piece_id: 'p1', precision: 'relevé de décembre' }, { document_id: 'd1' }])
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
    const motive = argumentsDeJustifierSolde(DOSSIER, 2025, {
      compte: '108000', soldeCentimes: -5, etat: 'accepte', motif: ' prélèvements ', portee: 'permanente', sources: [],
      preuveApplication: null, remplaceId: UUID(1), repriseDe: UUID(2),
    })
    expect(motive).toMatchObject({ p_solde: -0.05, p_motif: ' prélèvements ', p_portee: 'permanente', p_remplace_id: UUID(1), p_reprise_de: UUID(2), p_preuves: [] })
  })

  // Le solde part en euros, des centimes divisés par cent : la base doit lire les mêmes centimes, sans quoi le refus 9
  // tomberait sur un solde juste. Tiré au hasard jusqu'à cent milliards d'euros, et les bornes.
  it('le solde envoyé se relit au centime, pour tout montant', () => {
    const suivant = tirage(20261010)
    const montants = [0, 1, -1, 5, 10, 99, 100, 103425, -1234, 2675, 1005, 30, 999999999999, -999999999999]
    for (let i = 0; i < 20000; i++) montants.push((entierTire(suivant, 2) === 0 ? 1 : -1) * entierTire(suivant, 10_000_000_000_000))
    for (const c of montants) expect(centimesDuSoldeAnnonce(c / 100), String(c)).toBe(c)
    expect(centimesDuSoldeAnnonce(0.1 + 0.2)).toBeNull()
    expect(centimesDuSoldeAnnonce(1.5e-7)).toBeNull()
    expect(centimesDuSoldeAnnonce(1e21)).toBeNull()
    expect(centimesDuSoldeAnnonce(-0)).toBe(0)
    expect(centimesDuSoldeAnnonce(12.5)).toBe(1250)
  })

  it('un montant comme la base l’écrit : sans séparateur, la virgule, des dièses au-delà de quatorze chiffres', () => {
    expect(soldeCommeLaBase(103425)).toBe('1034,25')
    expect(soldeCommeLaBase(-5)).toBe('0,05')
    // Relevé en production : quatorze chiffres s'écrivent, quinze rendent « ##############,## ». Le plus grand nombre de
    // centimes qu'un double porte exactement a quatorze chiffres avant la virgule ; 10¹⁶ centimes, quinze.
    expect(soldeCommeLaBase(Number.MAX_SAFE_INTEGER)).toBe('90071992547409,91')
    expect(soldeCommeLaBase(10_000_000_000_000_000)).toBe('##############,##')
    expect(soldeCommeLaBase(-10_000_000_000_000_000)).toBe('##############,##')
  })
})

// ── Une source citée ne se retire plus (hypothèse Q8) ─────────────────────────────────────────────────────────────

describe('ce que garder_source_citee refuserait, dit avant le clic', () => {
  const sql = derniereDefinitionSql('garder_source_citee')
  const premiere512 = decision({ id: UUID(1), annee: 2025, compte: '512000' })
  const seconde512 = decision({ id: UUID(2), annee: 2025, compte: '512000', remplace_id: UUID(1) })
  const tva2024 = decision({ id: UUID(3), annee: 2024, compte: '445660' })
  const banque2024 = decision({ id: UUID(4), annee: 2024, compte: '512000' })
  const P = UUID(101)
  const D = UUID(201)

  it('le message est celui du déclencheur, mot pour mot', () => {
    expect(sql).toContain("raise exception '% par la révision du solde du compte % (exercice %) : %, sauf avec son dossier.'")
    for (const morceau of ["'Cette pièce est citée'", "'Ce document est cité'", "'elle ne se supprime plus'", "'il ne se supprime plus'",
      "'elle ne change plus de dossier'", "'il ne change plus de dossier'", 'v_compte, v_annee', 'order by j.annee, j.compte']) {
      expect(sql, morceau).toContain(morceau)
    }
  })

  it('les mots de l’essai joué en production (contrôles 137 à 140)', () => {
    const decisions = [premiere512, seconde512, decision({ id: UUID(5), compte: '580000' })]
    const preuves = [
      citation({ justification_id: UUID(1), piece_id: P }), citation({ justification_id: UUID(1), document_id: D }),
      citation({ justification_id: UUID(5), document_id: UUID(202) }),
    ]
    expect(refusDuRetraitDUneSource({ pieceId: P }, 'changement-de-dossier', decisions, preuves))
      .toBe('Cette pièce est citée par la révision du solde du compte 512000 (exercice 2025) : elle ne change plus de dossier, sauf avec son dossier.')
    expect(refusDuRetraitDUneSource({ documentId: D }, 'changement-de-dossier', decisions, preuves))
      .toBe('Ce document est cité par la révision du solde du compte 512000 (exercice 2025) : il ne change plus de dossier, sauf avec son dossier.')
    expect(refusDuRetraitDUneSource({ documentId: UUID(202) }, 'changement-de-dossier', decisions, preuves))
      .toBe('Ce document est cité par la révision du solde du compte 580000 (exercice 2025) : il ne change plus de dossier, sauf avec son dossier.')
  })

  it('la suppression, d’une pièce et d’un document', () => {
    const preuves = [citation({ justification_id: UUID(1), piece_id: P }), citation({ justification_id: UUID(1), document_id: D })]
    expect(refusDuRetraitDUneSource({ pieceId: P }, 'suppression', [premiere512], preuves))
      .toBe('Cette pièce est citée par la révision du solde du compte 512000 (exercice 2025) : elle ne se supprime plus, sauf avec son dossier.')
    expect(refusDuRetraitDUneSource({ documentId: D }, 'suppression', [premiere512], preuves))
      .toBe('Ce document est cité par la révision du solde du compte 512000 (exercice 2025) : il ne se supprime plus, sauf avec son dossier.')
  })

  it('même citée par une décision remplacée depuis ; la première par exercice, puis par compte', () => {
    // La décision remplacée garde ses preuves : la source reste gardée.
    expect(citationQuiGarde({ pieceId: P }, [premiere512, seconde512], [citation({ justification_id: UUID(1), piece_id: P })]))
      .toEqual({ annee: 2025, compte: '512000' })
    const preuves = [UUID(1), UUID(3), UUID(4)].map((j, i) => citation({ id: `c${i}`, justification_id: j, piece_id: P }))
    expect(citationQuiGarde({ pieceId: P }, [premiere512, tva2024, banque2024], preuves)).toEqual({ annee: 2024, compte: '445660' })
    expect(citationQuiGarde({ pieceId: P }, [premiere512, banque2024], preuves)).toEqual({ annee: 2024, compte: '512000' })
  })

  it('rien quand rien ne la cite ; une pièce et un document du même identifiant ne se confondent pas', () => {
    const preuves = [citation({ justification_id: UUID(1), document_id: P })]
    expect(refusDuRetraitDUneSource({ pieceId: P }, 'suppression', [premiere512], preuves)).toBeNull()
    expect(refusDuRetraitDUneSource({ pieceId: UUID(999) }, 'suppression', [premiere512], [citation({ justification_id: UUID(1), piece_id: P })])).toBeNull()
    // Une preuve dont la décision n'est pas lue ne garde rien d'ici : l'écran lit toutes les décisions du dossier.
    expect(refusDuRetraitDUneSource({ pieceId: P }, 'suppression', [], [citation({ justification_id: UUID(1), piece_id: P })])).toBeNull()
    // Les identifiants se comparent sans la casse.
    expect(citationQuiGarde({ pieceId: P.toUpperCase() }, [premiere512], [citation({ justification_id: UUID(1).toUpperCase(), piece_id: P })]))
      .toEqual({ annee: 2025, compte: '512000' })
    expect(citationQuiGarde({ pieceId: P }, [{ ...premiere512, id: UUID(1).toUpperCase() }], [citation({ justification_id: UUID(1), piece_id: P })]))
      .toEqual({ annee: 2025, compte: '512000' })
  })
})

// ── La mémoire d'un exercice à l'autre ────────────────────────────────────────────────────────────────────────────

describe('la mémoire : une justification permanente se propose, elle ne se recopie pas seule', () => {
  const h = 'ab'.repeat(32)
  const permanente = decision({ id: UUID(21), annee: 2024, compte: '164000', solde: -3000, etat: 'justifie', portee: 'permanente', motif: 'tableau de la banque' })
  const sources = [citation({ id: 'c1', justification_id: UUID(21), document_id: UUID(31), empreinte: h, precision: 'ligne 24' }), citation({ id: 'c2', justification_id: UUID(21), piece_id: UUID(41), empreinte: null })]
  const pieces = new Map([[UUID(41), { storage_hash: null }]])
  const documents = new Map([[UUID(31), { storage_hash: h }]])

  it('propose la décision permanente courante de l’exercice précédent, ses empreintes relues', () => {
    const r = repriseProposee(2025, '164000', -200000, [permanente], sources, pieces, documents)
    expect(r).toMatchObject({ compte: '164000', soldePrecedentCentimes: -300000, soldeChange: true, empreintesQuiNeTiennentPlus: 0 })
    expect(r?.decision.id).toBe(UUID(21))
    expect(r?.citations.map((c) => c.etat)).toEqual(['intacte', 'sans-empreinte'])
    expect(repriseProposee(2025, '164000', -300000, [permanente], sources, pieces, documents)?.soldeChange).toBe(false)
  })

  it('dit une empreinte qui ne tient plus', () => {
    const r = repriseProposee(2025, '164000', -200000, [permanente], sources, pieces, new Map([[UUID(31), { storage_hash: 'cd'.repeat(32) }]]))
    expect(r?.empreintesQuiNeTiennentPlus).toBe(1)
    const disparue = repriseProposee(2025, '164000', -200000, [permanente], sources, pieces, new Map([[UUID(31), { storage_hash: null }]]))
    expect(disparue?.empreintesQuiNeTiennentPlus).toBe(1)
  })

  it('ne relit que les citations de la décision reprise ; une source introuvable ne tient plus, un fichier du cabinet ne se recompose pas', () => {
    const autres = [
      ...sources,
      citation({ id: 'c3', justification_id: UUID(21), fichier_id: UUID(51), empreinte: h }),
      citation({ id: 'c4', justification_id: UUID(99), piece_id: UUID(41), empreinte: null }),
    ]
    const r = repriseProposee(2025, '164000', -200000, [permanente], autres, pieces, documents)
    expect(r?.citations.map((c) => [c.preuve.id, c.etat])).toEqual([['c1', 'intacte'], ['c2', 'sans-empreinte'], ['c3', 'introuvable']])
    expect(r?.empreintesQuiNeTiennentPlus).toBe(1)
    expect(decisionDeLaReprise(r!, -200000, null).sources).toHaveLength(2)
  })

  it('reprend l’état de la décision reprise : un solde accepté sur motif se reprend accepté', () => {
    const acceptee = decision({ ...permanente, etat: 'accepte' })
    const r = repriseProposee(2025, '164000', -200000, [acceptee], sources, pieces, documents)
    expect(decisionDeLaReprise(r!, -200000, null).etat).toBe('accepte')
  })

  it('la décision composée est permanente à son tour : l’exercice suivant pourra la reprendre', () => {
    const r = repriseProposee(2025, '164000', -200000, [permanente], sources, pieces, documents)
    expect(decisionDeLaReprise({ ...r!, decision: decision({ ...permanente, portee: 'exercice' }) }, -200000, null).portee).toBe('permanente')
  })

  it('rien pour une décision de l’exercice seul, un compte déjà décidé, un solde nul', () => {
    expect(repriseProposee(2025, '164000', -200000, [{ ...permanente, portee: 'exercice' }], sources, pieces, documents)).toBeNull()
    expect(repriseProposee(2025, '164000', -200000, [permanente, decision({ id: UUID(22), annee: 2025, compte: '164000' })], sources, pieces, documents)).toBeNull()
    expect(repriseProposee(2025, '164000', 0, [permanente], sources, pieces, documents)).toBeNull()
    expect(repriseProposee(2025, '401000', -200000, [permanente], sources, pieces, documents)).toBeNull()
    // Deux exercices plus tôt ne se reprend pas : la reprise vise l'exercice précédent.
    expect(repriseProposee(2026, '164000', -200000, [permanente], sources, pieces, documents)).toBeNull()
  })

  it('suit le remplacement : c’est la courante de l’exercice précédent qui se propose', () => {
    const remplacante = decision({ id: UUID(23), annee: 2024, compte: '164000', solde: -3000, portee: 'permanente', remplace_id: UUID(21) })
    expect(repriseProposee(2025, '164000', -200000, [permanente, remplacante], sources, pieces, documents)?.decision.id).toBe(UUID(23))
    expect(repriseProposee(2025, '164000', -200000, [permanente, { ...remplacante, portee: 'exercice' }], sources, pieces, documents)).toBeNull()
  })

  it('la décision qu’elle compose passe les refus de la base : la reprise, permanente, au solde du jour, ses sources', () => {
    const r = repriseProposee(2025, '164000', -200000, [permanente], sources, pieces, documents)
    const composee = decisionDeLaReprise(r!, -200000, null)
    expect(composee).toMatchObject({ compte: '164000', soldeCentimes: -200000, etat: 'justifie', motif: 'tableau de la banque', portee: 'permanente', repriseDe: UUID(21), remplaceId: null, preuveApplication: null })
    expect(composee.sources).toEqual([{ pieceId: null, documentId: UUID(31), precision: 'ligne 24' }, { pieceId: UUID(41), documentId: null, precision: null }])
    const contexte: ContexteDeJustification = {
      accesAuDossier: true, anneeCourante: 2026, reprise: [], reportes: [soldeReporte({ compte: '164000', sens: 'credit', montant: 2000 })],
      anneesValidees: [2024], ecritures: [], decisions: [permanente], pieces: [{ id: UUID(41) }], documents: [{ id: UUID(31) }],
    }
    expect(refusDeJustifierSolde(argumentsDeJustifierSolde(DOSSIER, 2025, composee), contexte)).toBeNull()
  })
})

// ── La révision d'un exercice ─────────────────────────────────────────────────────────────────────────────────────

describe('la révision d’un exercice, assemblée', () => {
  const h = 'ab'.repeat(32)
  // 2025, l'exercice de la reprise : la banque à 800 et le capital à 800 au 1er janvier ; des honoraires de 1 500, un
  // achat de 200, un prélèvement de 300, un virement interne de 100. La banque finit à 1 700, le compte de l'exploitant à
  // 300, les virements internes à 100 ; un compte mal formé (« 51 ») porte 5.
  const base = donnees({
    reprise: [aNouveau({ id: 'a1', compte: '512000', montant: 800, libelle: 'Banque' }), aNouveau({ id: 'a2', compte: '101000', sens: 'credit', montant: 800, libelle: 'Capital' })],
    ecritures: [
      ...ecritureEquilibree('hon', '2025-02-01', '512000', '706000', 1500),
      ...ecritureEquilibree('ach', '2025-03-01', '606100', '512000', 200),
      ...ecritureEquilibree('pre', '2025-04-01', '108000', '512000', 300),
      ...ecritureEquilibree('vir', '2025-05-01', '580000', '512000', 100),
      ...ecritureEquilibree('mal', '2025-06-01', '51', '706000', 5),
    ],
    categories: [categorie({ compte_comptable: '706000', libelle: 'Honoraires' })],
    pieces: [piece({ id: 'p1', storage_hash: h })],
    documents: [documentDivers({ id: 'd1' })],
    decisions: [
      decision({ id: UUID(1), compte: '512000', solde: 1700, etat: 'justifie' }),
      decision({ id: UUID(2), compte: '108000', solde: 300, etat: 'accepte', motif: 'prélèvements' }),
      decision({ id: UUID(3), compte: '580000', solde: 50, etat: 'anomalie', motif: 'écart' }),
      decision({ id: UUID(4), compte: '455000', solde: 0, etat: 'justifie' }),
      decision({ id: UUID(5), annee: 2024, compte: '512000', solde: 1 }),
    ],
    preuves: [citation({ justification_id: UUID(1), piece_id: 'p1', empreinte: h })],
  })

  it('chaque compte de bilan de l’exercice, son solde, son état, sa preuve, dans l’ordre des comptes', () => {
    const r = revisionDeLExercice(base, [])
    expect(r.annee).toBe(2025)
    expect(r.lectureIncomplete).toBeNull()
    expect(r.exercice).toEqual({ type: 'revisable' })
    expect(r.message).toBeNull()
    expect(r.peutDecider).toBe(true)
    expect(r.comptes.map((c) => [c.compte, c.soldeCentimes, c.etat])).toEqual([
      ['101000', -80000, 'a-justifier'],
      ['108000', 30000, 'accepte'],
      ['455000', 0, 'justifie'],
      ['512000', 170000, 'justifie'],
      ['580000', 10000, 'a-revoir'],
    ])
    expect(r.comptes.find((c) => c.compte === '580000')?.causes).toEqual(['solde-change'])
    expect(r.comptes.map((c) => c.cycle)).toEqual(['capitaux', 'capitaux', 'capitaux', 'tresorerie', 'tresorerie'])
    expect(r.comptes.map((c) => c.preuve.type)).toEqual(['ouverture', 'decomposition-exploitant', 'aucune', 'releve', 'virements-internes'])
    expect(r.comptes.find((c) => c.compte === '512000')?.citations.map((c) => c.etat)).toEqual(['intacte'])
    expect(r.comptes.find((c) => c.compte === '512000')?.chaine.courante?.id).toBe(UUID(1))
    expect(r.comptes.find((c) => c.compte === '108000')?.citations).toEqual([])
    for (const c of r.comptes) expect(c.preuve).toEqual(preuveDuCompte(c.compte, c.soldeCentimes, base))
  })

  it('une source citée qui a changé fait revoir le solde', () => {
    const r = revisionDeLExercice({ ...base, pieces: [piece({ id: 'p1', storage_hash: 'cd'.repeat(32) })] }, [])
    expect(r.comptes.find((c) => c.compte === '512000')).toMatchObject({ etat: 'a-revoir', causes: ['empreinte-changee'] })
  })

  it('le libellé de la balance de l’exercice, celui du plan à défaut', () => {
    const r = revisionDeLExercice(base, [])
    expect(Object.fromEntries(r.comptes.map((c) => [c.compte, c.libelle]))).toEqual({
      101000: 'Capital', 108000: "Compte de l'exploitant", 455000: 'Associés — comptes courants', 512000: 'Banque', 580000: 'Virements internes',
    })
  })

  it('l’avancement compte chaque état, en tout et cycle par cycle, et les cycles portent leurs comptes', () => {
    const r = revisionDeLExercice(base, [])
    expect(r.avancement).toEqual({ 'en-attente': 0, 'solde-nul': 0, 'a-justifier': 1, justifie: 2, accepte: 1, anomalie: 0, 'a-revoir': 1 })
    expect(Object.keys(r.avancement)).toEqual([...ETATS_DU_SOLDE])
    expect(r.cycles.map((c) => [c.cycle, c.comptes])).toEqual([
      ['tresorerie', ['512000', '580000']],
      ['recettes', []],
      ['depenses', []],
      ['social', []],
      ['capitaux', ['101000', '108000', '455000']],
      ['ensemble', []],
    ])
    expect(r.cycles.find((c) => c.cycle === 'tresorerie')?.avancement).toEqual({ 'en-attente': 0, 'solde-nul': 0, 'a-justifier': 0, justifie: 1, accepte: 0, anomalie: 0, 'a-revoir': 1 })
    expect(r.cycles.find((c) => c.cycle === 'capitaux')?.avancement).toEqual({ 'en-attente': 0, 'solde-nul': 0, 'a-justifier': 1, justifie: 1, accepte: 1, anomalie: 0, 'a-revoir': 0 })
    expect(r.cycles.find((c) => c.cycle === 'recettes')?.avancement).toEqual({ 'en-attente': 0, 'solde-nul': 0, 'a-justifier': 0, justifie: 0, accepte: 0, anomalie: 0, 'a-revoir': 0 })
  })

  it('range les contrôles existants dans leurs cycles, et ne tait ni un hors cycle ni un inconnu', () => {
    const controles = [
      { id: 'releve-incoherent', nb: 1 }, { id: 'concordance', nb: 2 }, { id: 'lecture-partielle', nb: null }, { id: 'nouveau-point', nb: 4 },
    ]
    const r = revisionDeLExercice(base, controles)
    expect(r.cycles.find((c) => c.cycle === 'tresorerie')?.controles).toEqual([{ id: 'releve-incoherent', nb: 1 }])
    expect(r.cycles.find((c) => c.cycle === 'ensemble')?.controles).toEqual([{ id: 'concordance', nb: 2 }])
    expect(r.cycles.find((c) => c.cycle === 'capitaux')?.controles).toEqual([])
    expect(r.controlesHorsCycle).toEqual([{ id: 'lecture-partielle', nb: null }])
    expect(r.controlesInconnus).toEqual([{ id: 'nouveau-point', nb: 4 }])
  })

  it('un contrôle qui a quelque chose à dire ouvre sa carte : le statut de TVA d’un dossier non redevable, le véhicule d’un registre vide', () => {
    const r = revisionDeLExercice(base, [{ id: 'statut-tva' }, { id: 'vehicule' }])
    expect(r.cycles.find((c) => c.cycle === 'tva')).toEqual({ cycle: 'tva', comptes: [], avancement: expect.any(Object), controles: [{ id: 'statut-tva' }] })
    expect(r.cycles.find((c) => c.cycle === 'immobilisations')?.controles).toEqual([{ id: 'vehicule' }])
    expect(r.cycles.map((c) => c.cycle)).toEqual(['tresorerie', 'recettes', 'depenses', 'immobilisations', 'social', 'tva', 'capitaux', 'ensemble'])
  })

  it('un compte de résultat n’ouvre aucune carte : le 758000 d’une catégorie, sur un dossier non redevable', () => {
    const r = revisionDeLExercice({ ...base, ecritures: [...base.ecritures, ...ecritureEquilibree('gain', '2025-09-01', '512000', '758000', 3)] }, [])
    expect(r.cycles.map((c) => c.cycle)).not.toContain('tva')
    expect(r.comptes.map((c) => c.compte)).not.toContain('758000')
  })

  it('un compte qui n’est ni de bilan au sens de la base ni de résultat se dit à part', () => {
    expect(revisionDeLExercice(base, []).horsDuMotif).toEqual([{ compte: '51', soldeCentimes: 500 }])
  })

  it('un compte qui n’a qu’une décision ouvre encore son cycle : aucun compte hors des cartes', () => {
    const r = revisionDeLExercice({ ...base, decisions: [...base.decisions, decision({ id: UUID(8), compte: '164000', solde: 0 })] }, [])
    expect(r.cycles.find((c) => c.cycle === 'emprunts')?.comptes).toEqual(['164000'])
    expect(r.comptes.find((c) => c.compte === '164000')).toMatchObject({ soldeCentimes: 0, etat: 'justifie' })
  })

  it('les comptes hors du motif qui portent un solde, dans l’ordre des comptes', () => {
    const r = revisionDeLExercice({
      ...base, ecritures: [...base.ecritures, ...ecritureEquilibree('m2', '2025-07-01', '45', '706000', 7), ...ecritureEquilibree('m3', '2025-08-01', '46', '46', 3), ...ecritureEquilibree('m4', '2025-08-02', '801000', '512000', 2)],
    }, [])
    expect(r.horsDuMotif).toEqual([{ compte: '45', soldeCentimes: 700 }, { compte: '51', soldeCentimes: 500 }, { compte: '801000', soldeCentimes: 200 }])
  })

  // Un compte que l'application ne nomme pas : la balance d'un autre exercice lui donnerait le nom de sa catégorie.
  it('le libellé d’un compte qui n’a qu’une décision dans l’exercice ne vient pas d’un autre exercice', () => {
    const r = revisionDeLExercice({
      ...base,
      ecritures: [...base.ecritures, ...ecritureEquilibree('ancien', '2024-06-01', '512000', '165000', 5)],
      categories: [...base.categories, categorie({ id: 'cat-165', compte_comptable: '165000', libelle: 'Nom donné par le cabinet' })],
      decisions: [...base.decisions, decision({ id: UUID(8), compte: '165000', solde: 0 })],
    }, [])
    expect(r.comptes.find((c) => c.compte === '165000')?.libelle).toBe('Dépôts et cautionnements reçus')
  })

  it('une décision prise après la validation de l’exercice, et une reprise de l’exercice précédent, se disent', () => {
    const r = revisionDeLExercice({
      ...base, exercicesValides: [{ annee: 2025, valide_le: '2026-01-15T10:00:00+00:00', empreinte: 'e'.repeat(64) }],
      decisions: [decision({ id: UUID(1), compte: '512000', solde: 1700, cree_le: '2026-02-01T10:00:00+00:00', reprise_de: UUID(5) })],
    }, [])
    expect(r.comptes.find((c) => c.compte === '512000')).toMatchObject({ apresLaValidation: true, repriseDeLExercicePrecedent: true })
    expect(r.comptes.find((c) => c.compte === '101000')).toMatchObject({ apresLaValidation: false, repriseDeLExercicePrecedent: false })
    // Validé, l'exercice se révise encore (§ 3.9).
    expect(r.peutDecider).toBe(true)
  })

  it('une lecture partielle n’affirme rien et n’offre aucun geste', () => {
    const r = revisionDeLExercice({ ...base, lectureIncomplete: 'les décisions ont été lues en partie' }, [{ id: 'releve-incoherent' }])
    expect(r).toMatchObject({ lectureIncomplete: 'les décisions ont été lues en partie', exercice: null, message: null, comptes: [], horsDuMotif: [], cycles: [], controlesHorsCycle: [], controlesInconnus: [], peutDecider: false })
    expect(Object.values(r.avancement).every((n) => n === 0)).toBe(true)
    expect(Object.keys(r.avancement)).toEqual([...ETATS_DU_SOLDE])
  })

  it('un exercice en cours : chaque solde attend, la phrase de la base, aucune reprise proposée, aucun geste', () => {
    const r = revisionDeLExercice({
      ...base, anneeCourante: 2025,
      decisions: [decision({ id: UUID(7), annee: 2024, compte: '101000', solde: -800, portee: 'permanente' })],
    }, [])
    expect(r.exercice).toEqual({ type: 'en-cours' })
    expect(r.message).toBe("L'exercice 2025 n'est pas terminé : ses soldes se justifient une fois clos.")
    expect(r.peutDecider).toBe(false)
    expect(r.comptes.length).toBeGreaterThan(0)
    expect(r.comptes.every((c) => c.etat === 'en-attente' && c.reprise === null)).toBe(true)
    expect(r.avancement['en-attente']).toBe(r.comptes.length)
  })

  it('un exercice révisable propose la reprise d’une justification permanente de l’exercice précédent', () => {
    const r = revisionDeLExercice({ ...base, decisions: [decision({ id: UUID(7), annee: 2024, compte: '101000', solde: -800, portee: 'permanente' })] }, [])
    expect(r.comptes.find((c) => c.compte === '101000')?.reprise).toMatchObject({ soldeChange: false, decision: { id: UUID(7) } })
  })

  it('le registre et les emprunts ouvrent leur carte, même sans compte de l’exercice', () => {
    const r = revisionDeLExercice({ ...base, immobilisations: [bien({ nature_id: 'n' })], natures: [nature({})], emprunts: [emprunt({ date_debut: '2027-01-01' })] }, [])
    expect(r.cycles.map((c) => c.cycle)).toEqual(['tresorerie', 'recettes', 'depenses', 'immobilisations', 'emprunts', 'social', 'capitaux', 'ensemble'])
    expect(r.cycles.find((c) => c.cycle === 'immobilisations')?.comptes).toEqual([])
  })

  it('l’instantané de chaque preuve passe le refus 12 de la base', () => {
    const r = revisionDeLExercice(base, [])
    let gardes = 0
    for (const c of r.comptes) {
      const instantane = instantaneDeLaPreuve(c.preuve)
      if (instantane === null) continue
      gardes++
      const contexte: ContexteDeJustification = {
        accesAuDossier: true, anneeCourante: 2026, reprise: base.reprise, reportes: [], anneesValidees: [], ecritures: base.ecritures,
        decisions: [], pieces: [], documents: [],
      }
      const a = argumentsDeJustifierSolde(DOSSIER, 2025, {
        compte: c.compte, soldeCentimes: c.soldeCentimes, etat: 'justifie', motif: null, portee: 'exercice', sources: [],
        preuveApplication: instantane, remplaceId: null, repriseDe: null,
      })
      expect(refusDeJustifierSolde(a, contexte), c.compte).toBeNull()
    }
    expect(gardes).toBe(4)
  })
})
