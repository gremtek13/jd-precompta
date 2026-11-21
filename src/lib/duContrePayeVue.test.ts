import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DU_CONTRE_PAYE_PREVU, EN_FACE_DIT, LIBELLES_DES_TRANCHES, PRESENTATION_DU_DU, RAISONS_NON_COMPARABLES, RELECTURE_DU_CLIENT,
  RESERVE_DES_CAISSES, TITRE_DU_DU, fenetreDuClientDite, fenetreProposee, motsDuDu, organismeDuDuDit, phraseSansCompte, phraseSansLecture,
} from './duContrePayeVue'
import { MOTS_DU_CABINET, motsDuCabinet } from './espaceVentes'

// Les mots de la section BOR5 (lib/duContrePayeVue.ts) : le drapeau baissé, la fenêtre commune, les états muets dits, aucun
// « impayé » ni conseil.

describe('les mots de ce que l’assurance maladie doit', () => {
  it('le drapeau est baissé (DU-Q1)', () => {
    expect(DU_CONTRE_PAYE_PREVU).toBe(false)
  })

  it('la fenêtre proposée : la période commune aux deux côtés, au plus jusqu’au jour ; nulle sans recouvrement', () => {
    const facture = [{ premier_lot_le: '2026-01-02', dernier_lot_le: '2026-02-27' }, { premier_lot_le: '2026-03-01', dernier_lot_le: '2026-03-31' }]
    const paye = [{ periode_du: '2026-01-10', periode_au: '2026-04-30' }]
    expect(fenetreProposee(facture, paye, '2026-04-20')).toEqual({ du: '2026-01-10', au: '2026-03-31' })
    expect(fenetreProposee(facture, paye, '2026-03-15')).toEqual({ du: '2026-01-10', au: '2026-03-15' })
    expect(fenetreProposee(facture, [{ periode_du: '2026-05-01', periode_au: '2026-05-31' }], '2026-06-01')).toBeNull()
    expect(fenetreProposee([], paye, '2026-04-20')).toBeNull()
  })

  it('chaque état muet se dit, jamais par un zéro', () => {
    const phrases = [
      phraseSansCompte({ etat: 'lecture_partielle', cotes: ['facture', 'paye'] }),
      phraseSansCompte({ etat: 'donnee_illisible', cote: 'paye' }),
      phraseSansCompte({ etat: 'donnee_illisible', cote: 'parametres' }),
      phraseSansCompte({ etat: 'fenetre_invalide', raison: 'a_l_envers' }),
      phraseSansCompte({ etat: 'fenetre_invalide', raison: 'a_venir' }),
      phraseSansCompte({ etat: 'rien_importe', cotes: ['paye'] }),
      phraseSansCompte({ etat: 'non_couvert', cotes: ['facture'], etendues: { facture: { du: '2026-01-02', au: '2026-03-31' }, paye: { du: '2026-01-02', au: '2026-04-15' } } }),
    ]
    expect(phrases[0]).toBe('Rien n’est confronté : les bordereaux et les paiements NOEMIE n’ont pas pu être lus en entier.')
    expect(phrases[6]).toContain('du 02/01/2026 au 31/03/2026')
    for (const p of phrases) expect(p).not.toMatch(/\b0[,.]00\b|0 €/)
  })

  it('l’organisme : le régime de la liste fermée, la caisse à trois chiffres', () => {
    expect(organismeDuDuDit({ part: 'obligatoire', regime: 2, caisse: 7 })).toBe('MSA, caisse 007')
    expect(organismeDuDuDit({ part: 'obligatoire', regime: 1, caisse: null })).toBe('CPAM, caisse non dite')
    expect(organismeDuDuDit({ part: 'complementaire', regime: null, caisse: null })).toBe('Part complémentaire, tous organismes')
  })

  it('les mots du client (DU-Q3) : tutoyé, aucun onglet ni forme du cabinet ; les mots partagés sont neutres', () => {
    const client = motsDuDu('client')
    const cabinet = motsDuDu('cabinet')
    expect(cabinet).toEqual({ titre: TITRE_DU_DU, presentation: PRESENTATION_DU_DU, reserve: RESERVE_DES_CAISSES })
    expect(client.titre).toBe('Ce que l’assurance maladie te doit (estimé)')
    expect(client.presentation).toContain('à vérifier dans ton logiciel de télétransmission')
    expect(client.presentation).not.toMatch(/praticien|2035|CA3|FEC/)
    expect(client.reserve).toContain('ton bordereau')
    const partages = [
      ...Object.values(LIBELLES_DES_TRANCHES), ...Object.values(RAISONS_NON_COMPARABLES),
      ...Object.values(EN_FACE_DIT).filter((e) => e !== null),
      phraseSansCompte({ etat: 'lecture_partielle', cotes: ['facture', 'paye'] }),
      phraseSansCompte({ etat: 'rien_importe', cotes: ['facture'] }),
      phraseSansCompte({ etat: 'non_couvert', cotes: ['paye'], etendues: { facture: { du: '2026-01-02', au: '2026-03-31' }, paye: { du: '2026-01-02', au: '2026-02-15' } } }),
      phraseSansCompte({ etat: 'fenetre_invalide', raison: 'a_venir' }),
      organismeDuDuDit({ part: 'obligatoire', regime: 1, caisse: 349 }),
    ]
    const duClient = [
      client.titre, client.presentation, client.reserve, RELECTURE_DU_CLIENT,
      fenetreDuClientDite({ du: '2026-03-05', au: '2026-03-30' }),
      phraseSansLecture('client', [{ etat: 'sans_banque' }, { etat: 'lus' }]),
      phraseSansLecture('client', [{ etat: 'echec', motif: 'ton accès à ta banque n’a pas pu être vérifié (droits illisibles)' }, { etat: 'lus' }]),
    ]
    for (const t of [...duClient, ...partages]) expect(motsDuCabinet(t), t).toEqual([])
    for (const m of MOTS_DU_CABINET) for (const t of duClient) expect(t, m.nom).not.toMatch(m.motif)
    expect(fenetreDuClientDite({ du: '2026-03-05', au: '2026-03-30' })).toBe('Lots créés du 05/03/2026 au 30/03/2026, la période que tes bordereaux et tes paiements importés couvrent ensemble.')
  })

  it('sans lecture : la case « Banque » retirée se dit au client, le motif d’un échec se dit, jamais un vide', () => {
    expect(phraseSansLecture('client', [{ etat: 'lus' }, { etat: 'sans_banque' }])).toContain('Ton accès ne porte plus « Banque »')
    expect(phraseSansLecture('cabinet', [{ etat: 'echec', motif: 'm1' }, { etat: 'echec', motif: 'm2' }])).toBe('Rien n’est confronté : m1 ; m2.')
    expect(phraseSansLecture('cabinet', [{ etat: 'lus' }, { etat: 'lus' }])).toBe('Rien n’est confronté : la lecture n’a pas abouti.')
  })

  it('aucun « impayé », aucun conseil dans les mots de la section', () => {
    const texte = readFileSync(resolve(process.cwd(), 'src/lib/duContrePayeVue.ts'), 'utf8') + readFileSync(resolve(process.cwd(), 'src/components/DuContrePaye.tsx'), 'utf8')
    const sansCommentaires = texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    expect(sansCommentaires).not.toMatch(/impay|relanc|réclam|il faut|tu dois|vous devez/i)
  })
})
