import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COMBINAISONS_DU_CHANGEMENT, DUREE_DE_L_AVIS_EN_JOURS, LECTURE_MANQUEE_AU_CABINET, LECTURE_MANQUEE_AU_CLIENT, LIBELLE_ALLER_AUX_FACTURES,
  LIBELLE_OUVRIR_MES_VENTES, NOM_DE_L_AVIS_DU_CABINET, NOM_DE_L_AVIS_DU_CLIENT, avisDuChangement, ceQueDitLAvis, changementAMontrer,
  destinataireDuClient, lireLeChangementDeRib, type DernierChangementLu, type DestinataireDuChangement, type LectureDeLAvis,
} from './changementDeRib'
import { motsDuCabinet } from './espaceVentes'
import { changementFictif, toutesLesCombinaisons, valeurRendue } from '../test/changementDeRib'

// L'AVIS DU DERNIER CHANGEMENT DU RIB, À L'ÉCRAN (espace client, étape A5b3b) : la règle de sa DURÉE (A5B3-Q4, décidée par le cabinet le
// 17/10/2026 « comme recommandé »), à qui il parle, et ce qu'on dit d'une lecture manquée. Le module est pur : le jour d'aujourd'hui lui
// est donné. Les dates attendues sont ÉCRITES ICI, à la main (jamais calculées par `ajouterJours`, qui est ce que la règle emploie).

const lu = (c: ReturnType<typeof changementFictif> | null): DernierChangementLu => ({ changement: c })

// Un changement du 12 octobre 2026 : J + 29 est le 10 novembre (octobre a 31 jours), J + 30 le 11.
const JOUR = '2026-10-12'
const DERNIER_JOUR = '2026-11-10'
const LENDEMAIN = '2026-11-11'

describe('la durée de l’avis : trente jours, le jour du changement compris', () => {
  it('trente, comme le cabinet l’a décidé', () => {
    expect(DUREE_DE_L_AVIS_EN_JOURS).toBe(30)
  })

  // Un changement qui n'est pas une proposition (chez le cabinet), ou n'importe lequel (chez le client) : du J au J + 29.
  it.each([
    ['cabinet', { geste: 'confirme', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'pose' } as const],
    ['cabinet', { geste: 'pose', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'pose' } as const],
    ['cabinet', { geste: 'retire', auteur: 'inconnu', etat: 'retire', ribEnVigueur: 'retire' } as const],
    ['ventes', { geste: 'change', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'change' } as const],
    ['banque', { geste: 'retire', auteur: 'inconnu', etat: 'retire', ribEnVigueur: 'aucun' } as const],
    // Le client lit la proposition aussi trente jours seulement : son cabinet en est averti à part.
    ['ventes', { geste: 'pose', auteur: 'client', etat: 'propose', ribEnVigueur: 'aucun' } as const],
    ['banque', { geste: 'change', auteur: 'client', etat: 'propose', ribEnVigueur: 'inchange' } as const],
  ] as [DestinataireDuChangement, Partial<ReturnType<typeof changementFictif>>][])('%s, %j : montré du jour du changement à J + 29, plus à J + 30', (destinataire, c) => {
    const changement = changementFictif({ ...c, jour: JOUR })
    expect(changementAMontrer(lu(changement), destinataire, JOUR), 'le jour du changement').toEqual(changement)
    expect(changementAMontrer(lu(changement), destinataire, '2026-10-13'), 'le lendemain').toEqual(changement)
    expect(changementAMontrer(lu(changement), destinataire, DERNIER_JOUR), 'J + 29, trentième jour').toEqual(changement)
    expect(changementAMontrer(lu(changement), destinataire, LENDEMAIN), 'J + 30').toBeNull()
    expect(changementAMontrer(lu(changement), destinataire, '2027-11-16'), 'J + 400').toBeNull()
  })

  it('les bords tiennent au passage d’une année et d’un mois bissextile', () => {
    // 20 décembre 2026 : J + 29 = 18 janvier 2027, J + 30 = 19.
    const noel = changementFictif({ jour: '2026-12-20', geste: 'confirme', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'pose' })
    expect(changementAMontrer(lu(noel), 'cabinet', '2027-01-18')).toEqual(noel)
    expect(changementAMontrer(lu(noel), 'cabinet', '2027-01-19')).toBeNull()
    // 1er février 2028 (bissextile) : J + 29 = 1er mars, J + 30 = 2 mars.
    const bissextile = changementFictif({ jour: '2028-02-01', geste: 'confirme', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'pose' })
    expect(changementAMontrer(lu(bissextile), 'ventes', '2028-03-01')).toEqual(bissextile)
    expect(changementAMontrer(lu(bissextile), 'ventes', '2028-03-02')).toBeNull()
  })

  it('un jour POSTÉRIEUR à aujourd’hui (l’horloge de l’appareil en retard) se montre', () => {
    for (const d of ['cabinet', 'ventes', 'banque'] as const) {
      const futur = changementFictif({ jour: JOUR, geste: 'confirme', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'pose' })
      expect(changementAMontrer(lu(futur), d, '2026-10-10'), d).toEqual(futur)
      expect(changementAMontrer(lu(futur), d, '2025-01-01'), d).toEqual(futur)
    }
  })

  it('un « aujourd’hui » qui n’est pas un jour civil ne tait rien', () => {
    const vieux = changementFictif({ jour: '2020-01-01', geste: 'confirme', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'pose' })
    for (const mauvais of ['', 'hier', '2026-13-40', '12/10/2026']) {
      expect(changementAMontrer(lu(vieux), 'cabinet', mauvais), mauvais).toEqual(vieux)
    }
  })

  it('« le RIB n’a jamais changé » ne montre rien, quel que soit le jour et le destinataire', () => {
    for (const d of ['cabinet', 'ventes', 'banque'] as const) {
      for (const jour of [JOUR, '2027-11-16', '2020-01-01']) expect(changementAMontrer(lu(null), d, jour)).toBeNull()
    }
  })

  // L'EXEMPTION DE LA PROPOSITION est celle du cabinet SEUL : il attend son geste, quel que soit l'âge du RIB proposé.
  it('chez le cabinet, un RIB proposé se montre à J + 400 ; chez le client « Ventes » et « Banque », non à J + 30', () => {
    const propose = changementFictif({ jour: JOUR, geste: 'pose', auteur: 'client', etat: 'propose', ribEnVigueur: 'aucun' })
    expect(changementAMontrer(lu(propose), 'cabinet', '2027-11-16')).toEqual(propose)
    expect(changementAMontrer(lu(propose), 'cabinet', '2030-01-01')).toEqual(propose)
    expect(changementAMontrer(lu(propose), 'ventes', LENDEMAIN)).toBeNull()
    expect(changementAMontrer(lu(propose), 'banque', LENDEMAIN)).toBeNull()
    expect(changementAMontrer(lu(propose), 'ventes', '2027-11-16')).toBeNull()
  })

  it('sur les quinze combinaisons : à J + 400, seule la proposition se montre, et seulement chez le cabinet', () => {
    const toutes = toutesLesCombinaisons(JOUR)
    expect(toutes.map((c) => `${c.geste}|${c.auteur}|${c.etat}|${c.ribEnVigueur}`).sort()).toEqual([...COMBINAISONS_DU_CHANGEMENT].sort())
    for (const c of toutes) {
      for (const d of ['cabinet', 'ventes', 'banque'] as const) {
        const attendu = d === 'cabinet' && c.etat === 'propose' ? c : null
        expect(changementAMontrer(lu(c), d, '2027-11-16'), `${d} ${c.geste}|${c.auteur}|${c.etat}|${c.ribEnVigueur}`).toEqual(attendu)
        // Et toutes se montrent le jour du changement, pour tous.
        expect(changementAMontrer(lu(c), d, JOUR)).toEqual(c)
      }
    }
  })

  it('un retrait, une confirmation ou une pose du cabinet n’ont pas l’exemption : ils tombent à J + 30 chez le cabinet', () => {
    for (const c of toutesLesCombinaisons(JOUR).filter((x) => x.etat !== 'propose')) {
      expect(changementAMontrer(lu(c), 'cabinet', DERNIER_JOUR), `${c.geste}`).toEqual(c)
      expect(changementAMontrer(lu(c), 'cabinet', LENDEMAIN), `${c.geste}`).toBeNull()
    }
  })
})

describe('à qui parle l’avis du client : « Ventes », sinon « Banque » seul, sinon personne', () => {
  it.each([
    [true, true, 'ventes'],
    [true, false, 'ventes'],
    [false, true, 'banque'],
    [false, false, null],
  ] as const)('« Ventes » ouverte : %s, « Banque » ouverte : %s — %s', (ventes, banque, attendu) => {
    expect(destinataireDuClient(ventes, banque)).toBe(attendu)
  })
})

describe('ce que l’écran dit de la lecture', () => {
  const AUJ = '2026-10-17'
  const propose = changementFictif({ jour: '2026-10-12' })
  const lue = (c: ReturnType<typeof changementFictif> | null): LectureDeLAvis => ({ etat: 'lue', lu: lu(c) })

  it('pas de lecture (drapeau baissé, aucune case, aucun dossier) ou pas revenue : rien', () => {
    for (const d of ['cabinet', 'ventes', 'banque'] as const) {
      expect(ceQueDitLAvis(null, d, AUJ), d).toEqual({ genre: 'rien' })
      expect(ceQueDitLAvis({ etat: 'en_cours' }, d, AUJ), d).toEqual({ genre: 'rien' })
    }
  })

  it('lue, « le RIB n’a jamais changé » ou un changement passé : rien', () => {
    expect(ceQueDitLAvis(lue(null), 'cabinet', AUJ)).toEqual({ genre: 'rien' })
    expect(ceQueDitLAvis(lue(null), 'ventes', AUJ)).toEqual({ genre: 'rien' })
    expect(ceQueDitLAvis(lue(propose), 'ventes', '2026-11-11')).toEqual({ genre: 'rien' })
    expect(ceQueDitLAvis(lue(propose), 'banque', '2026-11-11')).toEqual({ genre: 'rien' })
  })

  it('lue avec un changement à dire : l’avis du module, au destinataire, et l’attente d’une confirmation', () => {
    for (const d of ['cabinet', 'ventes', 'banque'] as const) {
      expect(ceQueDitLAvis(lue(propose), d, AUJ)).toEqual({ genre: 'avis', changement: propose, avis: avisDuChangement(propose, d), attend: true })
    }
    const confirme = changementFictif({ jour: '2026-10-12', geste: 'confirme', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'pose' })
    for (const d of ['cabinet', 'ventes', 'banque'] as const) {
      expect(ceQueDitLAvis(lue(confirme), d, AUJ), d).toEqual({ genre: 'avis', changement: confirme, avis: avisDuChangement(confirme, d), attend: false })
    }
  })

  it('chez le cabinet, la proposition de l’an dernier est encore dite ; chez le client, plus', () => {
    expect(ceQueDitLAvis(lue(propose), 'cabinet', '2027-10-17').genre).toBe('avis')
    expect(ceQueDitLAvis(lue(propose), 'ventes', '2027-10-17').genre).toBe('rien')
  })

  it('illisible : la ligne discrète, au cabinet vouvoyé, au client tutoyé — sans motif', () => {
    expect(ceQueDitLAvis({ etat: 'illisible' }, 'cabinet', AUJ)).toEqual({ genre: 'lecture_manquee', phrase: LECTURE_MANQUEE_AU_CABINET, motif: null })
    expect(ceQueDitLAvis({ etat: 'illisible' }, 'ventes', AUJ)).toEqual({ genre: 'lecture_manquee', phrase: LECTURE_MANQUEE_AU_CLIENT, motif: null })
    expect(ceQueDitLAvis({ etat: 'illisible' }, 'banque', AUJ)).toEqual({ genre: 'lecture_manquee', phrase: LECTURE_MANQUEE_AU_CLIENT, motif: null })
  })

  it('refusée : la même ligne, le motif en plus (pour l’infobulle)', () => {
    expect(ceQueDitLAvis({ etat: 'refusee', motif: 'permission denied' }, 'cabinet', AUJ))
      .toEqual({ genre: 'lecture_manquee', phrase: LECTURE_MANQUEE_AU_CABINET, motif: 'permission denied' })
    expect(ceQueDitLAvis({ etat: 'refusee', motif: 'permission denied' }, 'banque', AUJ))
      .toEqual({ genre: 'lecture_manquee', phrase: LECTURE_MANQUEE_AU_CLIENT, motif: 'permission denied' })
  })

  it('une lecture manquée se dit même quand le jour d’aujourd’hui est faux : jamais le silence', () => {
    expect(ceQueDitLAvis({ etat: 'illisible' }, 'cabinet', '').genre).toBe('lecture_manquee')
  })

  it('la valeur que rend la base, lue par le module, donne le même avis que le changement fictif', () => {
    for (const c of toutesLesCombinaisons('2026-10-12')) {
      const relu = lireLeChangementDeRib(valeurRendue(c))
      expect(relu, `${c.geste}|${c.auteur}`).toEqual({ changement: c })
    }
  })
})

describe('les phrases de la ligne discrète et les libellés', () => {
  const textes = [LECTURE_MANQUEE_AU_CABINET, LECTURE_MANQUEE_AU_CLIENT, LIBELLE_ALLER_AUX_FACTURES, LIBELLE_OUVRIR_MES_VENTES,
    NOM_DE_L_AVIS_DU_CABINET, NOM_DE_L_AVIS_DU_CLIENT]

  it('aucune n’affirme « aucun changement » ni ne nomme un RIB, une personne ou un montant', () => {
    for (const t of textes) {
      expect(t, t).not.toMatch(/\b(aucun|aucune|rien|jamais)\b/i)
      expect(t, t).not.toMatch(/IBAN|BIC|titulaire|FR76|@/)
      expect(t, t).not.toMatch(/\d/)
    }
  })

  it('celles du client passent le garde des mots du cabinet : tutoiement, aucun onglet, jamais « le client » pour lui', () => {
    for (const t of [LECTURE_MANQUEE_AU_CLIENT, LIBELLE_OUVRIR_MES_VENTES, NOM_DE_L_AVIS_DU_CLIENT]) expect(motsDuCabinet(t), t).toEqual([])
  })

  it('celle du cabinet n’est pas celle du client, et ne tutoie pas', () => {
    expect(LECTURE_MANQUEE_AU_CABINET).not.toBe(LECTURE_MANQUEE_AU_CLIENT)
    for (const t of [LECTURE_MANQUEE_AU_CABINET, NOM_DE_L_AVIS_DU_CABINET, LIBELLE_ALLER_AUX_FACTURES]) {
      expect(t, t).not.toMatch(/(?<![\p{L}])(tu|ta|ton|tes|te|toi)(?![\p{L}])/iu)
    }
  })

  it('le bouton du cabinet ne promet pas la vue « Paramètres » que son clic n’ouvre pas', () => {
    expect(LIBELLE_ALLER_AUX_FACTURES).not.toMatch(/Paramètres/)
  })

  it('chaque phrase que l’accueil du client peut dire passe le garde des mots du cabinet, sur les quinze combinaisons', () => {
    for (const c of toutesLesCombinaisons('2026-10-12')) {
      for (const d of ['ventes', 'banque'] as const) {
        const dit = ceQueDitLAvis({ etat: 'lue', lu: { changement: c } }, d, '2026-10-17')
        expect(dit.genre).toBe('avis')
        if (dit.genre !== 'avis') continue
        for (const t of [dit.avis.phrase, dit.avis.factures, dit.avis.conseil ?? '']) expect(motsDuCabinet(t), `${d} ${t}`).toEqual([])
      }
    }
  })
})

describe('le module reste pur', () => {
  const source = readFileSync(new URL('./changementDeRib.ts', import.meta.url), 'utf8')

  it('il n’importe ni la base ni le client Supabase, et ne lit pas l’horloge', () => {
    expect(source).not.toMatch(/from '\.\/supabase'/)
    expect(source).not.toMatch(/new Date\(|Date\.now\(|aujourdHuiAParis/)
  })
})
