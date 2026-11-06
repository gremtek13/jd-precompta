import { describe, expect, it } from 'vitest'
import {
  DOMAINE_DU_GENRE, GENRES_DU_JOURNAL, JOURNAL_MUET_DU_CLIENT, LIMITE_DU_JOURNAL, LIMITE_DU_JOURNAL_DU_CLIENT, PAR_TOI,
  PAR_TON_CABINET, PAR_UN_AUTRE_ACCES, PLAFOND_DU_JOURNAL, ceQueTesCasesNeMontrentPas, debutDeLaFenetre, genreOuvert,
  journalDeLEspaceClient, journalDuClient, libelleDeLEvenement, parQui, phraseDuCompte, phraseDuCompteDuClient,
  type CasesDuJournal, type GenreDuJournal, type LectureDUneSource, type LigneDuJournal, type SourcesDuJournal,
} from './journalDeLEspaceClient'
import type { AccesDuDossier } from './auteursVentes'
import { motsDuCabinet } from './espaceVentes'

// LE JOURNAL DE L'ESPACE CLIENT (étape B9b, la carte P10). Ce que ces cas gardent : seuls les gestes d'un compte reconnu
// parmi les accès lus EN ENTIER ; muet sur des accès ou une source lus en partie ; la fenêtre jugée au jour de Paris ; du plus
// récent au plus ancien, plafonné, le compte dit.

const AUJOURDHUI = '2026-11-06'
const CLIENT = 'u-client'
const MEMBRE = 'u-membre-du-cabinet'
const ACCES: AccesDuDossier = { etat: 'lus', comptes: [CLIENT] }

const ligne = (id: string, le: string, auteur: string | null = CLIENT, reference: string | null = null): LigneDuJournal =>
  ({ id, le, auteur, reference })

/** Toutes les sources lues vides, sauf celles qu'un cas donne. */
function sources(donnees: Partial<Record<GenreDuJournal, LectureDUneSource>> = {}): SourcesDuJournal {
  const v: LectureDUneSource = { etat: 'lue', lignes: [] }
  // Écrites une à une, sans `as` : le compilateur exige les vingt-six.
  const vides: SourcesDuJournal = {
    facture_creee: v, facture_validee: v, facture_transmise: v, encaissement_enregistre: v, encaissement_retire: v,
    encaissement_declare: v, statut_releve: v, devis_emis: v, devis_repondu: v, article_cree: v, article_modifie: v,
    article_retire: v, contact_cree: v, contact_modifie: v, contact_retire: v, contact_efface: v, parametres_changes: v,
    adresse_declaree: v, justificatif_propose: v, justificatif_retire: v, precision_mouvement: v, precision_piece: v,
    piece_deposee: v, email_envoye: v, caisse_saisie: v, caisse_retiree: v,
  }
  return { ...vides, ...donnees }
}

const lue = (...lignes: LigneDuJournal[]): LectureDUneSource => ({ etat: 'lue', lignes })

describe('la fenêtre', () => {
  it('compte trente jours, le jour donné compris', () => {
    expect(debutDeLaFenetre(AUJOURDHUI)).toBe('2026-10-08')
    expect(debutDeLaFenetre('2026-03-01')).toBe('2026-01-31')
  })

  it('juge l’instant au jour de Paris : 22 h 30 UTC la veille de la fenêtre est déjà dedans', () => {
    const j = journalDeLEspaceClient({
      acces: ACCES, aujourdhui: AUJOURDHUI,
      sources: sources({ piece_deposee: lue(
        ligne('dedans', '2026-10-07T22:30:00Z'),
        ligne('dehors', '2026-10-07T21:30:00Z'),
        ligne('demain', '2026-11-06T23:30:00Z'),
      ) }),
    })
    expect(j.etat === 'lu' && j.evenements.map((e) => e.id)).toEqual(['dedans'])
  })
})

describe('qui a fait quoi', () => {
  it('ne garde que les gestes du client : ni un membre du cabinet, ni un auteur nul', () => {
    const j = journalDeLEspaceClient({
      acces: ACCES, aujourdhui: AUJOURDHUI,
      sources: sources({
        facture_validee: lue(ligne('f1', '2026-11-01T10:00:00Z', CLIENT, 'F2026-0003'), ligne('f2', '2026-11-02T10:00:00Z', MEMBRE, 'F2026-0004')),
        piece_deposee: lue(ligne('p1', '2026-11-03T10:00:00Z', null)),
      }),
    })
    expect(j).toEqual({
      etat: 'lu', depuis: '2026-10-08', total: 1,
      evenements: [{ genre: 'facture_validee', id: 'f1', le: '2026-11-01T10:00:00Z', libelle: 'Facture F2026-0003 validée' }],
    })
  })

  it('un instant illisible ne date rien', () => {
    const j = journalDeLEspaceClient({
      acces: ACCES, aujourdhui: AUJOURDHUI, sources: sources({ email_envoye: lue(ligne('e1', 'pas une date')) }),
    })
    expect(j.etat === 'lu' && j.total).toBe(0)
  })

  it('du plus récent au plus ancien ; à instant égal, l’ordre des genres puis l’identifiant', () => {
    const meme = '2026-11-04T09:00:00Z'
    const j = journalDeLEspaceClient({
      acces: ACCES, aujourdhui: AUJOURDHUI,
      sources: sources({
        facture_creee: lue(ligne('f9', '2026-10-20T08:00:00Z')),
        facture_transmise: lue(ligne('t2', meme), ligne('t1', meme)),
        facture_validee: lue(ligne('f1', meme, CLIENT, 'F1')),
        devis_repondu: lue(ligne('d1', '2026-11-05T08:00:00Z', CLIENT, 'refusee')),
      }),
    })
    expect(j.etat === 'lu' && j.evenements.map((e) => `${e.genre}:${e.id}`)).toEqual([
      'devis_repondu:d1', 'facture_validee:f1', 'facture_transmise:t1', 'facture_transmise:t2', 'facture_creee:f9',
    ])
  })
})

describe('le plafond et le compte', () => {
  const vingtCinq = Array.from({ length: 25 }, (_, i) => ligne(`p${String(i).padStart(2, '0')}`, `2026-11-0${1 + (i % 5)}T0${i % 10}:00:00Z`))

  it('montre les plus récents, et dit combien sur combien', () => {
    const j = journalDeLEspaceClient({ acces: ACCES, aujourdhui: AUJOURDHUI, sources: sources({ piece_deposee: lue(...vingtCinq) }) })
    if (j.etat !== 'lu') throw new Error('attendu lu')
    expect(j.evenements).toHaveLength(20)
    expect(j.total).toBe(25)
    expect(phraseDuCompte(j)).toBe('Les 20 plus récents sur 25 évènements.')
    expect(j.evenements[0].le >= j.evenements[19].le).toBe(true)
  })

  it('un plafond donné l’emporte ; sous le plafond, le compte seul ; vide, l’absence dite', () => {
    const j = journalDeLEspaceClient({ acces: ACCES, aujourdhui: AUJOURDHUI, plafond: 3, sources: sources({ piece_deposee: lue(...vingtCinq) }) })
    expect(j.etat === 'lu' && j.evenements.length).toBe(3)
    const un = journalDeLEspaceClient({ acces: ACCES, aujourdhui: AUJOURDHUI, sources: sources({ email_envoye: lue(ligne('e1', '2026-11-01T10:00:00Z')) }) })
    expect(un.etat === 'lu' && phraseDuCompte(un)).toBe('1 évènement.')
    const vide = journalDeLEspaceClient({ acces: ACCES, aujourdhui: AUJOURDHUI, sources: sources() })
    expect(vide.etat === 'lu' && phraseDuCompte(vide)).toBe('Aucun geste du client depuis son espace sur la période.')
  })
})

describe('rien avant les lectures, rien sur une lecture partielle', () => {
  it('en cours tant que les accès ou les sources ne sont pas revenus', () => {
    expect(journalDeLEspaceClient({ acces: { etat: 'en_cours' }, aujourdhui: AUJOURDHUI, sources: sources() })).toEqual({ etat: 'en_cours' })
    expect(journalDeLEspaceClient({ acces: ACCES, aujourdhui: AUJOURDHUI, sources: null })).toEqual({ etat: 'en_cours' })
  })

  it('muet sur des accès lus en partie, même si les sources portent des gestes', () => {
    const j = journalDeLEspaceClient({
      acces: { etat: 'incomplets', motif: '1 ligne(s) lue(s) sur 2 annoncée(s)' }, aujourdhui: AUJOURDHUI,
      sources: sources({ piece_deposee: lue(ligne('p1', '2026-11-01T10:00:00Z')) }),
    })
    expect(j).toEqual({ etat: 'muet', motif: 'La liste des accès du dossier n’a pas été lue en entier (1 ligne(s) lue(s) sur 2 annoncée(s)).' })
  })

  it('muet sur une seule source lue en partie, qu’il nomme', () => {
    const j = journalDeLEspaceClient({
      acces: ACCES, aujourdhui: AUJOURDHUI,
      sources: sources({ piece_deposee: lue(ligne('p1', '2026-11-01T10:00:00Z')), contact_efface: { etat: 'partielle', motif: 'accès refusé' } }),
    })
    expect(j).toEqual({ etat: 'muet', motif: 'Une lecture n’a pas abouti en entier (Client effacé : accès refusé).' })
  })

  it('l’espace du client n’a pas ce journal', () => {
    expect(journalDeLEspaceClient({ acces: { etat: 'sans_objet' }, aujourdhui: AUJOURDHUI, sources: sources() }).etat).toBe('muet')
  })
})

describe('les libellés', () => {
  it('chaque genre a le sien, sans référence comme avec', () => {
    for (const g of GENRES_DU_JOURNAL) expect(libelleDeLEvenement(g, null)).not.toBe('')
    expect(new Set(GENRES_DU_JOURNAL.map((g) => libelleDeLEvenement(g, null))).size).toBe(GENRES_DU_JOURNAL.length)
    expect(libelleDeLEvenement('devis_emis', 'D2026-0001')).toBe('Devis D2026-0001 émis')
    expect(libelleDeLEvenement('devis_repondu', 'acceptee')).toBe('Devis noté accepté')
    expect(libelleDeLEvenement('devis_repondu', null)).toBe('Réponse à un devis notée')
    expect(libelleDeLEvenement('facture_validee', '')).toBe('Facture validée')
  })

  it('la limite dit ce qui n’y paraît pas', () => {
    expect(LIMITE_DU_JOURNAL).toContain('brouillon')
    expect(LIMITE_DU_JOURNAL).toContain('accès retiré')
  })
})

// ── Le journal côté client (étape B9c, « Mon analyse ») ───────────────────────────────────────────────────────────────
// Ce que ces cas gardent : chaque évènement sous la case de son domaine, que le module juge lui-même ; muet sur une source
// OUVERTE lue en partie ou pas lue, jamais à cause d'une source fermée ; aucun auteur rendu, seulement « par toi », « par ton
// cabinet », « par un autre accès de ta société », ou rien ; des mots qui tutoient et ne nomment aucun onglet.

const TOUTES_OUVERTES: CasesDuJournal = { ventes: true, banque: true, caisse: true }
const AUCUNE: CasesDuJournal = { ventes: false, banque: false, caisse: false }

/** Une ligne dans la fenêtre pour CHAQUE genre, d'un membre du cabinet. */
function uneParGenre(): SourcesDuJournal {
  const s: Record<GenreDuJournal, LectureDUneSource> = { ...sources() }
  for (const [i, g] of GENRES_DU_JOURNAL.entries()) s[g] = lue(ligne(`${g}-1`, `2026-11-0${(i % 5) + 1}T10:00:00Z`, MEMBRE))
  return s
}

describe('le journal du client : les cases', () => {
  it('sans case, seules les pièces et leurs précisions paraissent — même d’une source de ventes que l’appelant aurait lue', () => {
    const j = journalDuClient({ soi: CLIENT, cases: AUCUNE, sources: uneParGenre(), aujourdhui: AUJOURDHUI })
    expect(j.etat === 'lu' && new Set(j.evenements.map((e) => e.genre))).toEqual(new Set(['piece_deposee', 'precision_piece']))
  })

  it('chaque case ouvre son domaine, et lui seul', () => {
    const domaines = (cases: CasesDuJournal) => {
      const j = journalDuClient({ soi: CLIENT, cases, sources: uneParGenre(), aujourdhui: AUJOURDHUI, plafond: 100 })
      return j.etat === 'lu' ? j.evenements.map((e) => DOMAINE_DU_GENRE[e.genre]) : []
    }
    expect(new Set(domaines({ ...AUCUNE, banque: true }))).toEqual(new Set(['banque', 'tout_acces']))
    expect(new Set(domaines({ ...AUCUNE, caisse: true }))).toEqual(new Set(['caisse', 'tout_acces']))
    expect(new Set(domaines({ ...AUCUNE, ventes: true }))).toEqual(new Set(['ventes', 'tout_acces']))
    expect(domaines(TOUTES_OUVERTES)).toHaveLength(GENRES_DU_JOURNAL.length)
    // La banque : les justificatifs proposés, leur retrait, les précisions des mouvements — rien d'autre.
    expect(GENRES_DU_JOURNAL.filter((g) => DOMAINE_DU_GENRE[g] === 'banque'))
      .toEqual(['justificatif_propose', 'justificatif_retire', 'precision_mouvement'])
    expect(GENRES_DU_JOURNAL.filter((g) => genreOuvert(g, AUCUNE))).toEqual(['precision_piece', 'piece_deposee'])
  })

  it('une source fermée ne fait pas taire le journal ; une source OUVERTE lue en partie, ou pas lue, le fait taire', () => {
    const fermee: LectureDUneSource = { etat: 'fermee' }
    const partielle: LectureDUneSource = { etat: 'partielle', motif: 'tronquée' }
    const sansBanque = journalDuClient({
      soi: CLIENT, cases: { ...TOUTES_OUVERTES, banque: false }, aujourdhui: AUJOURDHUI,
      sources: sources({ justificatif_propose: partielle, precision_mouvement: fermee }),
    })
    expect(sansBanque.etat).toBe('lu')
    const ouverte = journalDuClient({
      soi: CLIENT, cases: TOUTES_OUVERTES, aujourdhui: AUJOURDHUI,
      sources: sources({ piece_deposee: lue(ligne('p1', '2026-11-05T10:00:00Z')), contact_cree: partielle }),
    })
    expect(ouverte).toEqual({ etat: 'muet', motif: 'Une lecture n’a pas abouti en entier (Client ajouté : tronquée).' })
    expect(journalDuClient({ soi: CLIENT, cases: AUCUNE, aujourdhui: AUJOURDHUI, sources: sources({ piece_deposee: fermee }) }).etat)
      .toBe('muet')
    expect(journalDuClient({ soi: CLIENT, cases: AUCUNE, aujourdhui: AUJOURDHUI, sources: null })).toEqual({ etat: 'en_cours' })
  })
})

describe('le journal du client : jamais qui', () => {
  it('« par toi », « par ton cabinet », « par un autre accès de ta société », ou rien — et aucun identifiant rendu', () => {
    const AUTRE = 'u-autre-acces'
    const j = journalDuClient({
      soi: CLIENT, cases: TOUTES_OUVERTES, aujourdhui: AUJOURDHUI,
      sources: sources({
        piece_deposee: lue(ligne('p-moi', '2026-11-05T10:00:00Z', CLIENT), ligne('p-autre', '2026-11-04T10:00:00Z', AUTRE),
          ligne('p-mail', '2026-11-03T10:00:00Z', null)),
        precision_piece: lue(
          { id: 'c-cab', le: '2026-11-05T09:00:00Z', auteur: MEMBRE, origine: 'cabinet' },
          { id: 'c-autre', le: '2026-11-05T08:00:00Z', auteur: AUTRE, origine: 'client' },
          { id: 'c-moi', le: '2026-11-05T07:00:00Z', auteur: CLIENT, origine: 'client' },
        ),
        facture_validee: lue(ligne('f1', '2026-11-02T10:00:00Z', MEMBRE, 'F2026-0004')),
      }),
    })
    if (j.etat !== 'lu') throw new Error(j.etat)
    expect(j.evenements.map((e) => [e.id, e.par])).toEqual([
      ['p-moi', PAR_TOI], ['c-cab', PAR_TON_CABINET], ['c-autre', PAR_UN_AUTRE_ACCES], ['c-moi', PAR_TOI],
      ['p-autre', null], ['p-mail', null], ['f1', null],
    ])
    // Tous les évènements, pas seulement ceux du client ; aucun ne porte d'auteur.
    expect(j.total).toBe(7)
    for (const e of j.evenements) expect(Object.keys(e).sort()).toEqual(['genre', 'id', 'le', 'libelle', 'par'])
    const rendu = JSON.stringify(j)
    for (const compte of [CLIENT, MEMBRE, AUTRE]) expect(rendu).not.toContain(compte)
  })

  it('sans compte connecté, personne n’est « toi »', () => {
    expect(parQui(ligne('x', '2026-11-05T10:00:00Z', CLIENT), null)).toBeNull()
    expect(parQui(ligne('x', '2026-11-05T10:00:00Z', null), '')).toBeNull()
  })
})

describe('le journal du client : la fenêtre, le plafond, le compte', () => {
  it('juge l’instant au jour de Paris, plafonne et dit le total', () => {
    const lignes = Array.from({ length: 25 }, (_, i) =>
      ligne(`p${String(i).padStart(2, '0')}`, `2026-11-0${(i % 5) + 1}T1${i % 10}:00:00Z`))
    const j = journalDuClient({
      soi: CLIENT, cases: AUCUNE, aujourdhui: AUJOURDHUI,
      sources: sources({ piece_deposee: lue(
        ...lignes, ligne('dedans', '2026-10-07T22:30:00Z'), ligne('dehors', '2026-10-07T21:30:00Z'),
        ligne('demain', '2026-11-06T23:30:00Z'),
      ) }),
    })
    if (j.etat !== 'lu') throw new Error(j.etat)
    expect(j.total).toBe(26)
    expect(j.evenements).toHaveLength(PLAFOND_DU_JOURNAL)
    expect(j.depuis).toBe('2026-10-08')
    expect(phraseDuCompteDuClient(j)).toBe('Les 20 plus récents sur 26 évènements.')
    expect(phraseDuCompteDuClient({ etat: 'lu', depuis: j.depuis, evenements: [], total: 0 })).toBe('Rien n’a bougé sur la période.')
  })
})

describe('les mots du client', () => {
  it('disent ce que les cases ne montrent pas', () => {
    expect(ceQueTesCasesNeMontrentPas(TOUTES_OUVERTES)).toBeNull()
    expect(ceQueTesCasesNeMontrentPas({ ...TOUTES_OUVERTES, banque: false }))
      .toBe('Ton accès n’ouvre pas ta banque : ce qui s’y fait n’y paraît pas.')
    expect(ceQueTesCasesNeMontrentPas(AUCUNE))
      .toBe('Ton accès n’ouvre ni tes ventes ni ta banque ni ta caisse : ce qui s’y fait n’y paraît pas.')
  })

  it('tutoient et ne nomment aucun onglet', () => {
    const textes = [
      ...GENRES_DU_JOURNAL.map((g) => libelleDeLEvenement(g, null)),
      libelleDeLEvenement('devis_repondu', 'acceptee'), libelleDeLEvenement('devis_repondu', 'refusee'),
      PAR_TOI, PAR_TON_CABINET, PAR_UN_AUTRE_ACCES, LIMITE_DU_JOURNAL_DU_CLIENT, JOURNAL_MUET_DU_CLIENT,
      ceQueTesCasesNeMontrentPas(AUCUNE) ?? '', ceQueTesCasesNeMontrentPas({ ...AUCUNE, ventes: true }) ?? '',
      phraseDuCompteDuClient({ etat: 'lu', depuis: '2026-10-08', evenements: [], total: 0 }),
    ]
    for (const t of textes) expect(motsDuCabinet(t), t).toEqual([])
  })
})
