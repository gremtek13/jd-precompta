import { describe, expect, it } from 'vitest'
import { fichiersDuSchema } from '../test/schema'
import type { ArticleExoneration, StatutTva } from './types'
import {
  DEBUT_EMISSION_PME,
  DEBUT_RECEPTION,
  EXONERATIONS,
  MENTION_FRANCHISE,
  STATUTS_TVA,
  VATEX_FRANCHISE,
  ecritureDuStatut,
  exonerationDe,
  libelleCourtStatutTva,
  manqueMentionTva,
  mentionTva,
  motifExoneration,
  obligationsFacturationElectronique,
  refusTauxPositif,
  resumeObligations,
} from './statutTva'

// La liste d'une contrainte `check (colonne in (…))`, telle que la DERNIÈRE migration qui la pose la laisse :
// une migration qui l'élargirait demain doit faire tomber ce test tant que le module ne la suit pas.
function listeDeLaContrainte(nom: string): string[] {
  let liste: string[] | null = null
  for (const fichier of fichiersDuSchema()) {
    const motif = new RegExp(`constraint\\s+${nom}\\s+check\\s*\\(\\s*\\w+\\s+in\\s*\\(([^)]*)\\)\\s*\\)`, 'gi')
    for (const m of fichier.texte.matchAll(motif)) liste = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])
  }
  if (liste == null) throw new Error(`La contrainte ${nom} est introuvable dans le schéma exporté.`)
  return liste
}

const ESPACE_INSECABLE = '\u00a0'

describe('les listes fermées suivent la base', () => {
  it('les statuts proposés sont exactement ceux que la base admet', () => {
    expect(STATUTS_TVA.map((s) => s.statut).sort()).toEqual(listeDeLaContrainte('dossiers_statut_tva_check').sort())
  })

  it('les exonérations proposées sont exactement celles que la base admet', () => {
    expect(EXONERATIONS.map((e) => e.code).sort()).toEqual(listeDeLaContrainte('dossiers_article_exoneration_check').sort())
  })

  it('la lecture de la contrainte n’est pas aveugle : une contrainte absente lève', () => {
    expect(() => listeDeLaContrainte('dossiers_contrainte_qui_n_existe_pas')).toThrow(/introuvable/)
  })

  it('chaque exonération cite sa disposition dans sa mention, et porte un code VATEX français', () => {
    for (const e of EXONERATIONS) {
      expect(e.mention).toBe(`Exonération de TVA, ${e.reference}.`)
      expect(e.vatex).toMatch(/^VATEX-FR-CGI261/)
    }
  })

  it('les soins ont leur article : 261, 4, 1°', () => {
    expect(exonerationDe('cgi_261_4_1')?.mention).toBe('Exonération de TVA, art. 261, 4, 1° du CGI.')
    expect(exonerationDe(null)).toBeNull()
  })
})

describe('libelleCourtStatutTva', () => {
  it('nomme les trois statuts, et le statut inconnu « à préciser »', () => {
    expect(libelleCourtStatutTva('redevable')).toBe('redevable')
    expect(libelleCourtStatutTva('franchise')).toBe('franchise en base')
    expect(libelleCourtStatutTva('exonere')).toBe('exonéré')
    expect(libelleCourtStatutTva(null)).toBe('à préciser')
  })
})

describe('ecritureDuStatut', () => {
  it('passer en franchise retire l’article, dans la même écriture — la base refuserait l’article', () => {
    expect(ecritureDuStatut('franchise', 'cgi_261_4_1')).toEqual({ statut_tva: 'franchise', article_exoneration: null })
  })

  it('un dossier exonéré ou redevable garde l’article choisi', () => {
    expect(ecritureDuStatut('exonere', 'cgi_261_4_1')).toEqual({ statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1' })
    expect(ecritureDuStatut('redevable', 'cgi_261_c_2')).toEqual({ statut_tva: 'redevable', article_exoneration: 'cgi_261_c_2' })
    expect(ecritureDuStatut('exonere', null)).toEqual({ statut_tva: 'exonere', article_exoneration: null })
  })
})

describe('mentionTva', () => {
  it('un dossier de soins exonérés cite l’art. 261, 4, 1°, jamais la franchise — le défaut d’origine', () => {
    expect(mentionTva('exonere', 'cgi_261_4_1')).toBe('Exonération de TVA, art. 261, 4, 1° du CGI.')
    expect(mentionTva('exonere', 'cgi_261_4_1')).not.toContain('293 B')
  })

  it('un dossier en franchise porte la mention de l’art. 293 B', () => {
    expect(mentionTva('franchise', null)).toBe(MENTION_FRANCHISE)
    expect(MENTION_FRANCHISE).toBe('TVA non applicable, art. 293 B du CGI.')
  })

  it('chaque exonération donne sa propre mention', () => {
    for (const e of EXONERATIONS) expect(mentionTva('exonere', e.code)).toBe(e.mention)
  })

  it('aucune mention pour un redevable, même en partie exonéré, ni quand on ne sait pas laquelle', () => {
    expect(mentionTva('redevable', null)).toBeNull()
    expect(mentionTva('redevable', 'cgi_261_4_1')).toBeNull()
    expect(mentionTva('exonere', null)).toBeNull()
    expect(mentionTva(null, null)).toBeNull()
  })
})

describe('manqueMentionTva', () => {
  it('dit le statut à préciser, et l’exonération sans article', () => {
    expect(manqueMentionTva(null, null)).toMatch(/à préciser/)
    expect(manqueMentionTva('exonere', null)).toMatch(/exonéré sans article/)
  })

  it('se tait quand la mention se propose seule, ou qu’il n’y en a pas', () => {
    expect(manqueMentionTva('exonere', 'cgi_261_4_4_b')).toBeNull()
    expect(manqueMentionTva('franchise', null)).toBeNull()
    expect(manqueMentionTva('redevable', null)).toBeNull()
  })
})

describe('motifExoneration', () => {
  it('la franchise transmet son motif propre, en catégorie E', () => {
    expect(motifExoneration('franchise', null)).toEqual({
      motif: { categorie: 'E', code: VATEX_FRANCHISE, texte: MENTION_FRANCHISE }, refus: null,
    })
  })

  it('un dossier exonéré transmet son article, pas la franchise — le défaut d’origine de superpdp-emit', () => {
    const r = motifExoneration('exonere', 'cgi_261_4_1')
    expect(r.refus).toBeNull()
    expect(r.motif).toEqual({ categorie: 'E', code: 'VATEX-FR-CGI261-4', texte: 'Exonération de TVA, art. 261, 4, 1° du CGI.' })
  })

  it('un redevable en partie exonéré transmet l’article de son exonération pour une ligne à 0 %', () => {
    expect(motifExoneration('redevable', 'cgi_261_c_2').motif).toEqual({
      categorie: 'E', code: 'VATEX-FR-CGI261C-2', texte: 'Exonération de TVA, art. 261 C, 2° du CGI.',
    })
  })

  it('chaque exonération transmet son code et sa mention', () => {
    for (const e of EXONERATIONS) {
      expect(motifExoneration('exonere', e.code).motif).toEqual({ categorie: 'E', code: e.vatex, texte: e.mention })
    }
  })

  it('refuse plutôt que de transmettre un motif qu’on ne connaît pas', () => {
    const inconnu = motifExoneration(null, null)
    expect(inconnu.motif).toBeNull()
    expect(inconnu.refus).toMatch(/à préciser/)
    const sansArticle = motifExoneration('exonere', null)
    expect(sansArticle.motif).toBeNull()
    expect(sansArticle.refus).toMatch(/exonéré sans article/)
    const redevable = motifExoneration('redevable', null)
    expect(redevable.motif).toBeNull()
    expect(redevable.refus).toMatch(/dossier redevable demande l’article/)
  })
})

describe('refusTauxPositif', () => {
  it('une ligne taxée sur un dossier en franchise ou exonéré est refusée, avec son taux', () => {
    expect(refusTauxPositif('franchise', 20)).toContain(`une ligne à 20${ESPACE_INSECABLE}%`)
    expect(refusTauxPositif('franchise', 20)).toMatch(/franchise en base/)
    expect(refusTauxPositif('exonere', 5.5)).toContain(`une ligne à 5,5${ESPACE_INSECABLE}%`)
    expect(refusTauxPositif('exonere', 5.5)).toMatch(/dossier exonéré/)
  })

  it('une ligne à 0 % ne l’est jamais, et un redevable facture la TVA', () => {
    for (const statut of ['redevable', 'franchise', 'exonere', null] as (StatutTva | null)[]) {
      expect(refusTauxPositif(statut, 0)).toBeNull()
    }
    expect(refusTauxPositif('redevable', 20)).toBeNull()
  })

  it('un statut à préciser se refuse ailleurs (motifExoneration), pas ici', () => {
    expect(refusTauxPositif(null, 20)).toBeNull()
  })
})

describe('obligationsFacturationElectronique', () => {
  const cles = ['reception', 'emission', 'transactions', 'paiements']
  const etats = (o: ReturnType<typeof obligationsFacturationElectronique>) => o.map((x) => x.etat)

  it('quatre obligations, toujours dans le même ordre', () => {
    const cas: [StatutTva | null, ArticleExoneration | null][] = [
      [null, null], ['redevable', null], ['redevable', 'cgi_261_4_1'], ['franchise', null], ['exonere', 'cgi_261_4_1'], ['exonere', null],
    ]
    for (const [statut, article] of cas) {
      expect(obligationsFacturationElectronique(statut, article, 'trimestrielle', false).map((o) => o.cle)).toEqual(cles)
    }
  })

  it('la réception est due par tout assujetti depuis le 1er septembre 2026 — même exonéré, même à préciser', () => {
    for (const statut of ['redevable', 'franchise', 'exonere', null] as (StatutTva | null)[]) {
      const [reception] = obligationsFacturationElectronique(statut, null, 'trimestrielle', false)
      expect(reception).toMatchObject({ cle: 'reception', etat: 'due', depuis: DEBUT_RECEPTION })
    }
    expect(DEBUT_RECEPTION).toBe('2026-09-01')
  })

  it('un dossier exonéré ne doit que la réception : ses opérations exonérées sortent du reste', () => {
    const o = obligationsFacturationElectronique('exonere', 'cgi_261_4_1', 'trimestrielle', false)
    expect(etats(o)).toEqual(['due', 'non_due', 'non_due', 'non_due'])
    for (const x of o.slice(1)) {
      expect(x.depuis).toBeNull()
      expect(x.detail).toContain('Ses opérations exonérées (art. 261, 4, 1° du CGI) en sortent.')
    }
    expect(obligationsFacturationElectronique('exonere', null, 'trimestrielle', false)[1].detail).toContain('Ses opérations exonérées en sortent.')
  })

  it('un franchisé est dans le champ : émission et e-reporting au 1er septembre 2027, tous les deux mois', () => {
    const o = obligationsFacturationElectronique('franchise', null, 'trimestrielle', false)
    expect(etats(o)).toEqual(['due', 'due', 'due', 'due'])
    expect(o.slice(1).map((x) => x.depuis)).toEqual([DEBUT_EMISSION_PME, DEBUT_EMISSION_PME, DEBUT_EMISSION_PME])
    expect(DEBUT_EMISSION_PME).toBe('2027-09-01')
    expect(o[2].detail).toContain('tous les deux mois')
    expect(o[3].detail).toContain('tous les deux mois')
  })

  it('l’option pour les débits ne regarde pas un franchisé, qui ne facture pas de TVA', () => {
    expect(obligationsFacturationElectronique('franchise', null, 'trimestrielle', true)[3].etat).toBe('due')
  })

  it('un redevable mensuel transmet ses transactions par décade, un trimestriel chaque mois ; ses paiements chaque mois', () => {
    const mensuel = obligationsFacturationElectronique('redevable', null, 'mensuelle', false)
    expect(etats(mensuel)).toEqual(['due', 'due', 'due', 'due'])
    expect(mensuel[2].detail).toContain('par décade')
    expect(mensuel[3].detail).toContain('chaque mois')
    const trimestriel = obligationsFacturationElectronique('redevable', null, 'trimestrielle', false)
    expect(trimestriel[2].detail).toContain('chaque mois')
    expect(trimestriel[2].detail).not.toContain('par décade')
  })

  it('sur option pour les débits, un redevable n’a pas de données de paiement à transmettre', () => {
    const o = obligationsFacturationElectronique('redevable', null, 'trimestrielle', true)
    expect(o[3]).toMatchObject({ cle: 'paiements', etat: 'non_due', depuis: null })
    expect(o[3].detail).toMatch(/option pour les débits/)
    expect(o[1].etat).toBe('due')
  })

  it('un redevable en partie exonéré n’est tenu que pour ses opérations taxables, et le dit', () => {
    const o = obligationsFacturationElectronique('redevable', 'cgi_261_4_1', 'trimestrielle', false)
    expect(etats(o)).toEqual(['due', 'en_partie', 'en_partie', 'en_partie'])
    for (const x of o.slice(1)) {
      expect(x.detail).toContain('Pour ses opérations taxables. Ses opérations exonérées (art. 261, 4, 1° du CGI) en sortent.')
      expect(x.depuis).toBe(DEBUT_EMISSION_PME)
    }
  })

  it('un statut à préciser ne promet rien d’autre que la réception', () => {
    const o = obligationsFacturationElectronique(null, null, 'trimestrielle', false)
    expect(etats(o)).toEqual(['due', 'a_preciser', 'a_preciser', 'a_preciser'])
    for (const x of o.slice(1)) {
      expect(x.depuis).toBeNull()
      expect(x.detail).toMatch(/à préciser/)
    }
  })
})

describe('resumeObligations', () => {
  it('dit en une phrase ce que chaque statut doit', () => {
    expect(resumeObligations(null, null)).toMatch(/^Réception des factures électroniques depuis le 1er septembre 2026 ; le reste dépend du statut de TVA, à préciser\.$/)
    expect(resumeObligations('exonere', 'cgi_261_4_1')).toMatch(/^Réception des factures électroniques seulement/)
    expect(resumeObligations('franchise', null)).toBe('Réception des factures électroniques depuis le 1er septembre 2026 ; émission et e-reporting au 1er septembre 2027.')
    expect(resumeObligations('redevable', null)).toBe('Réception des factures électroniques depuis le 1er septembre 2026 ; émission et e-reporting au 1er septembre 2027.')
    expect(resumeObligations('redevable', 'cgi_261_4_1')).toBe('Réception des factures électroniques depuis le 1er septembre 2026 ; émission et e-reporting au 1er septembre 2027, pour ses opérations taxables.')
  })
})
