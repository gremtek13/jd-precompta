import { describe, expect, it } from 'vitest'
import {
  EXPLICATION_DE_LA_CITATION, PASTILLE_DE_LA_CITATION, entreesParNature, entreesRetirees, informationSurUnElementSansEntree,
  libelleDeLaNature, validiteEnMots, versionsDuPlusRecentAuPlusAncien,
} from './dossierPermanentEcran'
import { ELEMENTS_PROPOSES_PAR_A9, NATURES_DU_DOSSIER_PERMANENT, entreesDuDossierPermanent } from './dossierPermanent'
import type { EtatDeLaCitation } from './revision'
import { entreePermanente, idDEntree } from '../test/dossierPermanent'

// LES MOTS ET LE RANGEMENT DE L'ÉCRAN DU DOSSIER PERMANENT (ligne 41, étape R7, phase C). Chaque attendu est écrit à la main,
// depuis la règle que cite le commentaire qui le précède : l'ordre de A9, les bornes comprises, une information et non une faute.

const entrees = (...lignes: ReturnType<typeof entreePermanente>[]) => entreesDuDossierPermanent(lignes).entrees

describe('libelleDeLaNature', () => {
  it('met le libellé de la base en tête de phrase', () => {
    expect(libelleDeLaNature('lettre_mission')).toBe('Lettre de mission')
    expect(libelleDeLaNature('description')).toBe("Description de l'entité")
    expect(libelleDeLaNature('contrat_emprunt')).toBe("Contrat d'emprunt")
    expect(libelleDeLaNature('autre')).toBe('Autre document')
  })
})

describe('validiteEnMots', () => {
  // Une borne nulle ne borne rien ; les bornes données sont comprises (lib/dossierPermanent.ts, `vautPourLExercice`).
  it('dit les quatre formes', () => {
    expect(validiteEnMots({ valable_du: null, valable_jusqu_au: null })).toBe('valable depuis toujours, sans terme')
    expect(validiteEnMots({ valable_du: '2024-07-01', valable_jusqu_au: '2033-06-30' })).toBe('valable du 01/07/2024 au 30/06/2033 (bornes comprises)')
    expect(validiteEnMots({ valable_du: '2026-01-01', valable_jusqu_au: null })).toBe('valable depuis le 01/01/2026, sans terme')
    expect(validiteEnMots({ valable_du: null, valable_jusqu_au: '2030-12-31' })).toBe('valable jusqu’au 31/12/2030')
  })
})

describe('entreesParNature', () => {
  // A9 : la lettre de mission, la description, l'organisation comptable, puis les statuts, le bail, les contrats, le reste.
  it('range les entrées courantes dans l’ordre de A9 et n’ouvre pas de groupe vide', () => {
    const lues = entrees(
      entreePermanente({ id: idDEntree(1), nature: 'autre', titre: 'Z' }),
      entreePermanente({ id: idDEntree(2), nature: 'bail', titre: 'B' }),
      entreePermanente({ id: idDEntree(3), nature: 'lettre_mission', titre: 'L' }),
      entreePermanente({ id: idDEntree(4), nature: 'bail', titre: 'B2', cree_le: '2026-02-01T10:00:00+00:00' }),
    )
    const groupes = entreesParNature(lues)
    expect(groupes.map((g) => g.nature)).toEqual(['lettre_mission', 'bail', 'autre'])
    expect(groupes.map((g) => g.libelle)).toEqual(['Lettre de mission', 'Bail', 'Autre document'])
    // Dans une nature : l'ordre où le module rend les entrées (leur première version).
    expect(groupes[1].entrees.map((e) => e.courante.titre)).toEqual(['B', 'B2'])
  })

  it('range une entrée sous la nature de sa version COURANTE (une nouvelle version peut la changer), et écarte les retirées', () => {
    const lues = entrees(
      entreePermanente({ id: idDEntree(1), nature: 'bail', titre: 'Première' }),
      entreePermanente({ id: idDEntree(2), nature: 'contrat', titre: 'Corrigée', remplace_id: idDEntree(1), cree_le: '2026-02-01T10:00:00+00:00' }),
      entreePermanente({ id: idDEntree(3), nature: 'statuts', titre: 'Retirée', retire_le: '2026-03-01T10:00:00+00:00', retire_par: 'u1' }),
    )
    const groupes = entreesParNature(lues)
    expect(groupes.map((g) => [g.nature, g.entrees.map((e) => e.courante.titre)])).toEqual([['contrat', ['Corrigée']]])
  })

  it('couvre les huit natures de la base, sans en oublier ni en inventer', () => {
    const lues = entrees(...NATURES_DU_DOSSIER_PERMANENT.map((nature, n) => entreePermanente({ id: idDEntree(n + 1), nature, titre: nature })))
    expect(entreesParNature(lues).map((g) => g.nature)).toEqual([...NATURES_DU_DOSSIER_PERMANENT])
  })
})

describe('entreesRetirees', () => {
  it('rend les retirées, la plus récemment retirée d’abord, et jamais une courante', () => {
    const lues = entrees(
      entreePermanente({ id: idDEntree(1), titre: 'Ancienne', retire_le: '2026-02-01T10:00:00+00:00', retire_par: 'u1' }),
      entreePermanente({ id: idDEntree(2), titre: 'Récente', retire_le: '2026-03-01T10:00:00+00:00', retire_par: 'u1' }),
      entreePermanente({ id: idDEntree(3), titre: 'Courante' }),
    )
    expect(entreesRetirees(lues).map((e) => e.courante.titre)).toEqual(['Récente', 'Ancienne'])
  })

  it('départage deux retraits du même instant par l’identifiant : un ordre total', () => {
    const lues = entrees(
      entreePermanente({ id: idDEntree(2), titre: 'B', retire_le: '2026-02-01T10:00:00+00:00', retire_par: 'u1' }),
      entreePermanente({ id: idDEntree(1), titre: 'A', retire_le: '2026-02-01T10:00:00+00:00', retire_par: 'u1' }),
    )
    expect(entreesRetirees(lues).map((e) => e.courante.titre)).toEqual(['A', 'B'])
  })
})

describe('versionsDuPlusRecentAuPlusAncien', () => {
  it('lit l’historique de haut en bas, la courante en tête', () => {
    const [entree] = entrees(
      entreePermanente({ id: idDEntree(1), titre: 'v1' }),
      entreePermanente({ id: idDEntree(2), titre: 'v2', remplace_id: idDEntree(1), cree_le: '2026-02-01T10:00:00+00:00' }),
      entreePermanente({ id: idDEntree(3), titre: 'v3', remplace_id: idDEntree(2), cree_le: '2026-03-01T10:00:00+00:00' }),
    )
    expect(versionsDuPlusRecentAuPlusAncien(entree).map((v) => v.titre)).toEqual(['v3', 'v2', 'v1'])
    // La liste de l'entrée n'est pas retournée en place : la chaîne garde son ordre.
    expect(entree.versions.map((v) => v.titre)).toEqual(['v1', 'v2', 'v3'])
  })
})

describe('l’information sur ce que A9 propose', () => {
  // NP 2300, A9 : le dossier « peut contenir » ces éléments, sans préjudice d'autres : ni la phrase ni le mot d'une faute.
  it('dit chaque élément proposé, en nommant l’exercice, sans accuser', () => {
    expect(informationSurUnElementSansEntree('lettre_mission', 2025)).toBe('Aucune lettre de mission n’est en vigueur en 2025.')
    expect(informationSurUnElementSansEntree('description', 2026)).toBe('Aucune description de l’entité et de son activité n’est en vigueur en 2026.')
    expect(informationSurUnElementSansEntree('organisation_comptable', 2025)).toBe('Aucune présentation de l’organisation comptable n’est en vigueur en 2025.')
    for (const nature of ELEMENTS_PROPOSES_PAR_A9) {
      expect(informationSurUnElementSansEntree(nature, 2025)).not.toMatch(/manque|obligatoire|doit|faute|anomalie|erreur|refus/i)
    }
  })

  it('a une phrase pour toute nature, même hors de la liste proposée', () => {
    for (const nature of NATURES_DU_DOSSIER_PERMANENT) {
      expect(informationSurUnElementSansEntree(nature, 2025)).toMatch(/^Aucun/)
    }
  })
})

describe('ce qu’une citation prouve encore, en mots', () => {
  const etats: EtatDeLaCitation[] = ['intacte', 'changee', 'disparue', 'sans-empreinte', 'introuvable']

  it('a un mot, une pastille et une phrase pour chaque état', () => {
    expect(Object.keys(PASTILLE_DE_LA_CITATION).sort()).toEqual([...etats].sort())
    expect(Object.keys(EXPLICATION_DE_LA_CITATION).sort()).toEqual([...etats].sort())
    expect(PASTILLE_DE_LA_CITATION.intacte).toEqual({ mot: 'empreinte intacte', classe: 'badge-ok' })
    expect(PASTILLE_DE_LA_CITATION.changee).toEqual({ mot: 'fichier changé depuis la citation', classe: 'badge-warning' })
    expect(PASTILLE_DE_LA_CITATION.disparue).toEqual({ mot: 'empreinte disparue', classe: 'badge-warning' })
    expect(PASTILLE_DE_LA_CITATION['sans-empreinte']).toEqual({ mot: 'sans empreinte', classe: 'badge-neutral' })
    expect(PASTILLE_DE_LA_CITATION.introuvable).toEqual({ mot: 'introuvable dans ce qui a été lu', classe: 'badge-neutral' })
  })

  it('ne dit « intacte » que de l’état qui l’est : aucun autre état n’a la pastille de la réussite', () => {
    expect(etats.filter((e) => PASTILLE_DE_LA_CITATION[e].classe === 'badge-ok')).toEqual(['intacte'])
  })
})
