import { readFileSync } from 'node:fs'
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
  declarationDuNonRedevable,
  ecritureDuStatut,
  numeroTvaACocher,
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
    expect(ecritureDuStatut('franchise', 'cgi_261_4_1', false)).toEqual({ statut_tva: 'franchise', article_exoneration: null, numero_tva_attribue: false })
  })

  it('un dossier exonéré ou redevable garde l’article choisi', () => {
    expect(ecritureDuStatut('exonere', 'cgi_261_4_1', false)).toEqual({ statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1', numero_tva_attribue: false })
    expect(ecritureDuStatut('redevable', 'cgi_261_c_2', false)).toEqual({ statut_tva: 'redevable', article_exoneration: 'cgi_261_c_2', numero_tva_attribue: false })
    expect(ecritureDuStatut('exonere', null, false)).toEqual({ statut_tva: 'exonere', article_exoneration: null, numero_tva_attribue: false })
  })

  // LA CASE DU NUMÉRO DE TVA (décision du cabinet du 08/10/2026) : gardée en franchise et exonéré, retirée dans la même
  // écriture quand le dossier devient redevable — la base la refuserait (dossiers_numero_tva_attribue_coherent).
  it('la case du numéro de TVA se garde en franchise et exonéré, et part quand le dossier devient redevable', () => {
    expect(ecritureDuStatut('franchise', null, true).numero_tva_attribue).toBe(true)
    expect(ecritureDuStatut('exonere', 'cgi_261_4_1', true).numero_tva_attribue).toBe(true)
    expect(ecritureDuStatut('redevable', null, true).numero_tva_attribue).toBe(false)
    expect([numeroTvaACocher('franchise'), numeroTvaACocher('exonere'), numeroTvaACocher('redevable'), numeroTvaACocher(null)])
      .toEqual([true, true, false, false])
  })

  it('les statuts où la case se coche sont ceux que la base admet', () => {
    const migration = readFileSync(new URL('../../supabase/schema/20261008070839_numero_de_tva_d_un_dossier_non_redevable.sql', import.meta.url), 'utf8')
    expect(migration).toContain("check (not numero_tva_attribue or coalesce(statut_tva in ('franchise', 'exonere'), false))")
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
  const cles = ['reception', 'emission', 'transactions', 'achats', 'paiements']
  const etats = (o: ReturnType<typeof obligationsFacturationElectronique>) => o.map((x) => x.etat)
  const de = (o: ReturnType<typeof obligationsFacturationElectronique>, cle: string) => o.find((x) => x.cle === cle)!
  const CAS: [StatutTva | null, ArticleExoneration | null][] = [
    [null, null], ['redevable', null], ['redevable', 'cgi_261_4_1'], ['franchise', null], ['exonere', 'cgi_261_4_1'], ['exonere', null],
    ['exonere', 'cgi_261_4_4_b'], ['exonere', 'cgi_261_c_2'],
  ]

  it('cinq obligations, toujours dans le même ordre — les achats à l’étranger ont la leur', () => {
    for (const [statut, article] of CAS) {
      expect(obligationsFacturationElectronique(statut, article, 'trimestrielle', false).map((o) => o.cle)).toEqual(cles)
    }
    expect(de(obligationsFacturationElectronique('franchise', null, 'trimestrielle', false), 'achats').libelle)
      .toBe('Transmettre ses achats à l’étranger (e-reporting)')
  })

  // LE TEXTE FAUX NE REVIENT PAS : un dossier exonéré « n'y est pas tenu », écrit sur trois lignes, était faux pour ses
  // achats à l'étranger (BOI-TVA-DECLA-20-30-50-10, §60) et pour ses opérations taxables.
  it('aucun statut ne dit plus « Il n’y est pas tenu », ni aucun état « non dû » à un dossier exonéré', () => {
    for (const [statut, article] of CAS) {
      for (const periodicite of ['mensuelle', 'trimestrielle'] as const) {
        for (const surDebits of [false, true]) {
          for (const o of obligationsFacturationElectronique(statut, article, periodicite, surDebits)) {
            expect(o.detail, `${statut} ${article} ${o.cle}`).not.toMatch(/n’y est pas tenu|n'y est pas tenu/)
          }
        }
      }
      if (statut === 'exonere') expect(etats(obligationsFacturationElectronique(statut, article, 'trimestrielle', false))).not.toContain('non_due')
    }
  })

  it('la réception est due par tout assujetti depuis le 1er septembre 2026 — même exonéré, même à préciser', () => {
    for (const statut of ['redevable', 'franchise', 'exonere', null] as (StatutTva | null)[]) {
      const [reception] = obligationsFacturationElectronique(statut, null, 'trimestrielle', false)
      expect(reception).toMatchObject({ cle: 'reception', etat: 'due', depuis: DEBUT_RECEPTION })
      expect(reception.detail).toMatch(/^Depuis le 1er septembre 2026, /)
    }
    expect(DEBUT_RECEPTION).toBe('2026-09-01')
  })

  // Un dossier exonéré (BOI-TVA-DECLA-20-30-50-10, §20 et §60 ; FAQ « J'approfondis » d'impots.gouv.fr, §2.10) : la
  // réception, ses achats à l'étranger, et le reste s'il a des opérations taxables.
  it('un dossier exonéré : ses achats à l’étranger sont dus, ses opérations taxables le cas échéant, avec la date', () => {
    const o = obligationsFacturationElectronique('exonere', 'cgi_261_4_1', 'trimestrielle', false)
    expect(etats(o)).toEqual(['due', 'le_cas_echeant', 'le_cas_echeant', 'due', 'le_cas_echeant'])
    expect(o.slice(1).map((x) => x.depuis)).toEqual(['2027-09-01', '2027-09-01', '2027-09-01', '2027-09-01'])
    expect(de(o, 'achats').detail).toBe('Même exonéré, il y est tenu : ses achats à un fournisseur établi hors de France — un '
      + 'logiciel en ligne, une formation, de la publicité —, chaque mois (fréquence à confirmer : les textes ne la disent pas '
      + 'pour un dossier exonéré ; celle du réel normal trimestriel est proposée, à confirmer avec son service des impôts). '
      + 'Il lui faut alors un numéro de TVA intracommunautaire. À partir du 1er septembre 2027 pour une PME ou une '
      + 'micro-entreprise (1er septembre 2026 pour une ETI ou une grande entreprise).')
    expect(de(o, 'emission').detail).toBe('Ses opérations exonérées (art. 261, 4, 1° du CGI) en sortent. S’il a aussi des '
      + 'opérations taxables — la redevance que lui verse un collaborateur, par exemple —, ses factures à des professionnels '
      + 'établis en France s’émettent sous forme électronique. À partir du 1er septembre 2027 pour une PME ou une '
      + 'micro-entreprise (1er septembre 2026 pour une ETI ou une grande entreprise).')
    expect(de(o, 'transactions').detail).toMatch(/^Ses opérations exonérées \(art\. 261, 4, 1° du CGI\) en sortent\. S’il a aussi des opérations taxables à des particuliers ou à des clients établis hors de France, elles s’y déclarent, chaque mois \(fréquence à confirmer\)\. À partir du 1er septembre 2027/)
    expect(de(o, 'paiements').detail).toMatch(/^Ses opérations exonérées \(art\. 261, 4, 1° du CGI\) en sortent\. S’il a aussi des prestations de services taxables : le statut « Encaissée » de ses factures et l’e-reporting de ses paiements, chaque mois \(fréquence à confirmer\)\. À partir du 1er septembre 2027/)
  })

  it('l’exemple de la redevance d’un collaborateur ne vaut que pour les soins, et un exonéré sans article le dit aussi', () => {
    // FAQ « J'approfondis », §2.10 : la collaboration libérale d'un professionnel de santé.
    const enseignement = obligationsFacturationElectronique('exonere', 'cgi_261_4_4_b', 'trimestrielle', false)
    expect(de(enseignement, 'emission').detail).toMatch(/^Ses opérations exonérées \(art\. 261, 4, 4° b du CGI\) en sortent\. S’il a aussi des opérations taxables, ses factures/)
    expect(enseignement.map((x) => x.detail).join(' ')).not.toMatch(/collaborateur/)
    const sansArticle = obligationsFacturationElectronique('exonere', null, 'trimestrielle', false)
    expect(de(sansArticle, 'transactions').detail).toMatch(/^Ses opérations exonérées en sortent\. S’il a aussi/)
    expect(etats(sansArticle)).toEqual(['due', 'le_cas_echeant', 'le_cas_echeant', 'due', 'le_cas_echeant'])
  })

  it('un franchisé est dans le champ : émission et e-reporting au 1er septembre 2027, tous les deux mois', () => {
    const o = obligationsFacturationElectronique('franchise', null, 'trimestrielle', false)
    expect(etats(o)).toEqual(['due', 'due', 'due', 'due', 'due'])
    expect(o.slice(1).map((x) => x.depuis)).toEqual([DEBUT_EMISSION_PME, DEBUT_EMISSION_PME, DEBUT_EMISSION_PME, DEBUT_EMISSION_PME])
    expect(DEBUT_EMISSION_PME).toBe('2027-09-01')
    expect(de(o, 'transactions').detail).toMatch(/^Ses ventes à des particuliers et à des clients établis hors de France, tous les deux mois\. /)
    expect(de(o, 'achats').detail).toMatch(/^Ses achats à un fournisseur établi hors de France — un logiciel en ligne, une formation, de la publicité —, tous les deux mois\. Il lui faut alors un numéro de TVA intracommunautaire\. À partir du 1er septembre 2027/)
    expect(de(o, 'paiements').detail).toContain('tous les deux mois')
  })

  it('l’option pour les débits ne regarde pas un franchisé, qui ne facture pas de TVA', () => {
    expect(de(obligationsFacturationElectronique('franchise', null, 'trimestrielle', true), 'paiements').etat).toBe('due')
  })

  it('un redevable mensuel transmet ses ventes et ses achats par décade, un trimestriel chaque mois ; ses paiements chaque mois', () => {
    const mensuel = obligationsFacturationElectronique('redevable', null, 'mensuelle', false)
    expect(etats(mensuel)).toEqual(['due', 'due', 'due', 'due', 'due'])
    expect(de(mensuel, 'transactions').detail).toContain('par décade')
    expect(de(mensuel, 'achats').detail).toContain('par décade')
    expect(de(mensuel, 'paiements').detail).toContain('chaque mois')
    const trimestriel = obligationsFacturationElectronique('redevable', null, 'trimestrielle', false)
    expect(de(trimestriel, 'transactions').detail).toContain('chaque mois')
    expect(de(trimestriel, 'transactions').detail).not.toContain('par décade')
    expect(de(trimestriel, 'achats').detail).toContain('chaque mois')
    // Un redevable a toujours un numéro de TVA : la ligne ne lui en demande pas.
    expect(de(trimestriel, 'achats').detail).not.toMatch(/numéro de TVA/)
  })

  it('sur option pour les débits, un redevable n’a pas de données de paiement à transmettre', () => {
    const o = obligationsFacturationElectronique('redevable', null, 'trimestrielle', true)
    expect(de(o, 'paiements')).toMatchObject({ cle: 'paiements', etat: 'non_due', depuis: null })
    expect(de(o, 'paiements').detail).toMatch(/option pour les débits/)
    expect(de(o, 'emission').etat).toBe('due')
    expect(de(o, 'achats').etat).toBe('due')
  })

  it('un redevable en partie exonéré n’est tenu que pour ses opérations taxables, et le dit — ses achats, en entier', () => {
    const o = obligationsFacturationElectronique('redevable', 'cgi_261_4_1', 'trimestrielle', false)
    expect(etats(o)).toEqual(['due', 'en_partie', 'en_partie', 'due', 'en_partie'])
    for (const cle of ['emission', 'transactions', 'paiements']) {
      expect(de(o, cle).detail).toContain('Pour ses opérations taxables. Ses opérations exonérées (art. 261, 4, 1° du CGI) en sortent.')
      expect(de(o, cle).depuis).toBe(DEBUT_EMISSION_PME)
    }
    expect(de(o, 'achats').detail).not.toContain('Pour ses opérations taxables')
  })

  it('un statut à préciser promet la réception et les achats à l’étranger, et rien d’autre', () => {
    const o = obligationsFacturationElectronique(null, null, 'trimestrielle', false)
    expect(etats(o)).toEqual(['due', 'a_preciser', 'a_preciser', 'due', 'a_preciser'])
    for (const cle of ['emission', 'transactions', 'paiements']) {
      expect(de(o, cle).depuis).toBeNull()
      expect(de(o, cle).detail).toMatch(/à préciser/)
    }
    expect(de(o, 'achats').depuis).toBe('2027-09-01')
    expect(de(o, 'achats').detail).toMatch(/quel que soit son statut de TVA ; leur fréquence en dépend, à préciser dans l’onglet TVA\./)
  })
})

describe('resumeObligations', () => {
  it('dit en une phrase ce que chaque statut doit', () => {
    expect(resumeObligations(null, null)).toBe('Réception des factures électroniques depuis le 1er septembre 2026 ; e-reporting de ses '
      + 'achats à l’étranger au 1er septembre 2027 ; le reste dépend du statut de TVA, à préciser.')
    expect(resumeObligations('exonere', 'cgi_261_4_1')).toBe('Réception des factures électroniques depuis le 1er septembre 2026 ; '
      + 'au 1er septembre 2027, e-reporting de ses achats à l’étranger, et émission et e-reporting de ses opérations taxables '
      + 's’il en a : ses opérations exonérées en sortent.')
    expect(resumeObligations('franchise', null)).toBe('Réception des factures électroniques depuis le 1er septembre 2026 ; émission et e-reporting au 1er septembre 2027.')
    expect(resumeObligations('redevable', null)).toBe('Réception des factures électroniques depuis le 1er septembre 2026 ; émission et e-reporting au 1er septembre 2027.')
    expect(resumeObligations('redevable', 'cgi_261_4_1')).toBe('Réception des factures électroniques depuis le 1er septembre 2026 ; '
      + 'émission et e-reporting au 1er septembre 2027, pour ses opérations taxables, et e-reporting de ses achats à l’étranger.')
  })

  it('ne dit plus d’un dossier exonéré « Réception des factures électroniques seulement »', () => {
    for (const article of [null, ...EXONERATIONS.map((e) => e.code)]) {
      expect(resumeObligations('exonere', article)).not.toMatch(/seulement/)
      expect(resumeObligations('exonere', article)).toContain('e-reporting de ses achats à l’étranger')
    }
  })
})

describe('declarationDuNonRedevable — ce que l’onglet TVA dit quand il ne prépare pas de CA3', () => {
  // CGI, art. 283, 2 : la TVA d'un service acheté à un prestataire non établi est due par le preneur ; BOI-TVA-DECLA-20-10-20,
  // §40 : un numéro de TVA lui est attribué pour cela, franchisé ou exonéré compris.
  it('un franchisé ou un exonéré : pas de TVA sur ses ventes, mais celle d’un service acheté à l’étranger, que l’application ne prépare pas', () => {
    const suite = 'Mais la TVA d’un service qu’il achète à un prestataire établi hors de France — un logiciel en ligne, une '
      + 'formation, de la publicité — est due par lui (autoliquidation, art. 283, 2 du CGI) : il la déclare alors, avec un '
      + 'numéro de TVA intracommunautaire. L’application ne prépare pas encore cette déclaration.'
    expect(declarationDuNonRedevable('franchise')).toBe(`En franchise en base, le dossier ne facture pas de TVA et n’en déclare pas sur ses ventes. ${suite}`)
    expect(declarationDuNonRedevable('exonere')).toBe(`Exonéré, le dossier ne facture pas de TVA et n’en déclare pas sur ses opérations exonérées. ${suite}`)
  })

  it('ne dit plus, sans réserve, « il n’a pas de déclaration à déposer »', () => {
    for (const statut of ['redevable', 'franchise', 'exonere', null] as (StatutTva | null)[]) {
      expect(declarationDuNonRedevable(statut)).not.toMatch(/pas de déclaration à déposer/)
    }
  })

  it('un statut à préciser se dit à préciser ; un redevable prépare ses déclarations ici', () => {
    expect(declarationDuNonRedevable(null)).toBe('Tant que son statut de TVA est à préciser, le dossier est traité comme ne '
      + 'récupérant pas la TVA : redevable, il préparerait ici ses déclarations.')
    expect(declarationDuNonRedevable('redevable')).toBe('Redevable, le dossier prépare ses déclarations de TVA dans cet onglet.')
  })
})
