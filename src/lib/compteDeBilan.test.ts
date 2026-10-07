import { describe, expect, it } from 'vitest'
import { mouvementJustifieParLeReleve, refusAffectation, type MouvementBancaire } from './affectationBanque'
import { refusEcritSurUnCompteDeBilan } from './classementsDuMouvement'
import {
  COMPTE_BANQUE, COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES, COMPTE_VIREMENTS_INTERNES, libelleDuPlanComptable,
} from './comptes'
import {
  COMPTES_DE_BILAN_PROPOSES, REFUS_COMPTE_DE_BILAN_CLASSE, ecritureDuCompteDeBilan, idsMouvementsSurUnCompteDeBilan,
  libelleDuCompteDeBilan, lireCompteSaisi, mouvementsSurUnCompteDeBilanDesynchronises, refusCompteDeBilan,
  refusCompteDeBilanDuMouvement, refusMouvementCompteDeBilan,
} from './compteDeBilan'
import { montantsDesMouvementsIgnores, mouvementRapprocheSansObjet, mouvementsIgnoresHorsFec } from './controles'
import { refusRapprochementCotisation } from './cotisationRapprochee'
import { refusEcheanceEmprunt } from './echeanceEmprunt'
import type { ModeleComptable } from './engagement'
import { REFUS_REGLE_EN_GROUPE, refusReglementGroupe } from './reglementGroupe'
import type { EcritureBrouillon, ModeComptable } from './types'
import { refusVentilation } from './ventilationBanque'
import { refusVirementPersonnel } from './virementPersonnel'
import { NON_VALIDEE } from '../test/ecritures'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT_SOCIETE: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

function mouvement(o: Partial<MouvementBancaire> = {}): MouvementBancaire {
  return {
    id: 'l1', date: '2026-03-12', libelle: 'VIR EPARGNE', libelle_brut: null, montant: -2000,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null,
    ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
    ...o,
  }
}

function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  return {
    id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: 'l1', date: '2026-03-12', compte: COMPTE_VIREMENTS_INTERNES,
    libelle: 'VIR EPARGNE', montant: 2000, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
    ...NON_VALIDEE, created_at: '2026-03-12T10:00:00Z',
    ...o,
  }
}

const definitionSql = derniereDefinitionSql

// Une apostrophe se double en SQL, se courbe à l'écran : comparées, elles sont la même.
const sansApostrophes = (s: string) => s.replace(/''/g, "'").replace(/’/g, "'")

// ── LA FONCTION SQL `refus_compte_de_bilan`, EXÉCUTÉE ────────────────────────────────────────────────────────────
// Elle n'est qu'un `case` dont chaque branche teste le compte par une expression rationnelle, le modèle ou le compte du
// dirigeant. Un petit interprète l'exécute ici sur les mêmes comptes que l'application : le même ordre, les mêmes
// raisons et les mêmes conditions se vérifient ainsi d'un coup, là où relire les deux textes ne prouverait rien. Une
// condition qu'il ne sait pas lire le fait ÉCHOUER — jamais passer : une forme nouvelle dans la base ne doit pas
// rendre la comparaison muette.
interface CasSql { condition: string; message: string }

function casDuRefus(sql: string): CasSql[] {
  const debut = sql.indexOf('select case')
  const fin = sql.lastIndexOf('end')
  expect(debut).toBeGreaterThan(0)
  const corps = sql.slice(debut + 'select case'.length, fin)
  const cas: CasSql[] = []
  const motif = /when\s+([\s\S]+?)\s+then\s+(?:format\(\s*)?'((?:[^']|'')*)'/g
  for (let m = motif.exec(corps); m; m = motif.exec(corps)) cas.push({ condition: m[1].replace(/\s+/g, ' ').trim(), message: m[2] })
  return cas
}

function atomeVrai(atome: string, compte: string | null, mode: string, dirigeant: string): boolean {
  if (atome === 'p_compte is null') return compte == null
  if (atome === 'p_compte = p_dirigeant') return compte != null && compte === dirigeant
  const regex = /^p_compte (!?~) '([^']*)'$/.exec(atome)
  // Un nul n'est ni égal ni différent : la branche n'est pas prise, comme en SQL.
  if (regex) return compte != null && (regex[1] === '~') === new RegExp(regex[2]).test(compte)
  const modeEgal = /^p_mode = '([a-z]+)'$/.exec(atome)
  if (modeEgal) return mode === modeEgal[1]
  throw new Error(`Condition SQL non reconnue : ${atome}`)
}

// `and` lie plus fort que `or`, comme en SQL ; aucune condition de la fonction n'a de parenthèses hors de ses
// expressions rationnelles.
function conditionVraie(condition: string, compte: string | null, mode: string, dirigeant: string): boolean {
  return condition.split(/ or /).some((disjonction) =>
    disjonction.split(/ and /).every((atome) => atomeVrai(atome.trim(), compte, mode, dirigeant)))
}

function refusSql(cas: readonly CasSql[], compte: string | null, mode: string, dirigeant: string): { message: string | null; rang: number } {
  for (const [rang, c] of cas.entries()) {
    if (conditionVraie(c.condition, compte, mode, dirigeant)) return { message: c.message.replace(/''/g, "'").replace('%s', dirigeant), rang }
  }
  return { message: null, rang: -1 }
}

// Tous les comptes à trois chiffres de 000 à 999, complétés à six, et des sous-comptes plus longs : chaque branche de
// la fonction est atteinte, et les bornes de ses expressions aussi (5[1-4] contre 50 et 55, 10[5-7] contre 104 et 108,
// 444 contre 443 et 445…). Plus ce qu'un appel direct pourrait envoyer de mal formé.
function batterie(): (string | null)[] {
  const comptes: (string | null)[] = [null, '', '12345', '12345678901', 'abc123', '27500a', '275 00', '+275000']
  for (let p = 0; p <= 999; p++) {
    const prefixe = String(p).padStart(3, '0')
    comptes.push(`${prefixe}000`, `${prefixe}1`.padEnd(6, '0'), `${prefixe}1234567`)
  }
  return comptes
}

const MODES: ModeComptable[] = ['tresorerie', 'engagement']
const DIRIGEANTS = ['108000', '455000', '467000']

describe('lireCompteSaisi — la saisie d’un compte, sous la forme des comptes de l’application', () => {
  it('complète à six chiffres, et les zéros de fin ne font pas un autre compte', () => {
    for (const saisie of ['275', '2750', '275000', '2750000', '2750000000', ' 275 000 ', '275.000', '275 000', '275 000']) {
      expect(lireCompteSaisi(saisie), saisie).toEqual({ compte: '275000', refus: null })
    }
    expect(lireCompteSaisi('27.41')).toEqual({ compte: '274100', refus: null })
    expect(lireCompteSaisi('4551')).toEqual({ compte: '455100', refus: null })
  })

  it('garde un sous-compte plus long que six chiffres, jusqu’à dix', () => {
    expect(lireCompteSaisi('27500001')).toEqual({ compte: '27500001', refus: null })
    expect(lireCompteSaisi('2741000012')).toEqual({ compte: '2741000012', refus: null })
  })

  it('rien de tapé n’est pas un refus', () => {
    expect(lireCompteSaisi('')).toEqual({ compte: null, refus: null })
    expect(lireCompteSaisi('   ')).toEqual({ compte: null, refus: null })
  })

  it('refuse des lettres, moins de trois chiffres, plus de dix', () => {
    expect(lireCompteSaisi('27A').refus).toBe('Un numéro de compte ne s’écrit qu’avec des chiffres.')
    expect(lireCompteSaisi('-275').refus).toBe('Un numéro de compte ne s’écrit qu’avec des chiffres.')
    expect(lireCompteSaisi('27').refus).toContain('trois chiffres au moins')
    expect(lireCompteSaisi('12345678901').refus).toBe('Un numéro de compte a dix chiffres au plus.')
    for (const s of ['27A', '27', '12345678901']) expect(lireCompteSaisi(s).compte).toBeNull()
  })

  it('rend toujours un compte de la forme que la base exige', () => {
    for (let n = 100; n < 100_000; n += 7) {
      const { compte } = lireCompteSaisi(String(n))
      expect(compte).toMatch(/^[0-9]{6,10}$/)
    }
  })
})

describe('refusCompteDeBilan — le même ordre et les mêmes raisons que la fonction SQL exportée', () => {
  const cas = casDuRefus(definitionSql('refus_compte_de_bilan'))

  it('lit toutes les branches de la fonction', () => {
    expect(cas.length).toBe(18)
  })

  it('rend, compte par compte, modèle par modèle, la phrase de la base ou rien quand elle n’en a pas', () => {
    const atteints = new Set<number>()
    let acceptes = 0
    for (const compte of batterie()) {
      for (const mode of MODES) {
        for (const dirigeant of DIRIGEANTS) {
          const sql = refusSql(cas, compte, mode, dirigeant)
          const ici = refusCompteDeBilan(compte, mode, dirigeant)
          expect(ici === null ? null : sansApostrophes(ici), `${compte} ${mode} ${dirigeant}`).toBe(sql.message === null ? null : sansApostrophes(sql.message))
          atteints.add(sql.rang)
          if (ici === null) acceptes++
        }
      }
    }
    // Chaque branche atteinte, et des comptes acceptés : sans eux, la comparaison prouverait moins qu'elle ne dit.
    expect([...atteints].sort((a, b) => a - b)).toEqual([-1, ...cas.map((_, i) => i)])
    expect(acceptes).toBeGreaterThan(100)
  })

  // L'interprète lui-même, éprouvé : retirer une branche de la fonction SQL doit faire diverger la comparaison, et une
  // condition qu'il ne sait pas lire doit lever. Sans cela, « les deux disent la même chose » et « l'interprète ne lit
  // rien » se ressembleraient.
  it('l’interprète voit une branche retirée, et refuse une condition qu’il ne sait pas lire', () => {
    const sansEmprunt = cas.filter((c) => !c.condition.includes("'^164'"))
    expect(sansEmprunt.length).toBe(cas.length - 1)
    expect(refusSql(sansEmprunt, '164000', 'tresorerie', '108000').message).toBeNull()
    expect(refusCompteDeBilan('164000', 'tresorerie', '108000')).toContain('emprunt')
    expect(() => conditionVraie("p_compte like '1%'", '100000', 'tresorerie', '108000')).toThrow('Condition SQL non reconnue')
  })

  it('accepte les deux comptes proposés, dans les deux modèles et pour tout dirigeant', () => {
    for (const { compte } of COMPTES_DE_BILAN_PROPOSES) {
      for (const mode of MODES) for (const dirigeant of DIRIGEANTS) expect(refusCompteDeBilan(compte, mode, dirigeant)).toBeNull()
    }
  })

  it('le compte du dirigeant se refuse, l’autre compte de tiers non', () => {
    expect(refusCompteDeBilan('455000', 'engagement', '455000')).toContain('« Virement personnel »')
    expect(refusCompteDeBilan('455000', 'engagement', '455000')).toContain('(455000)')
    expect(refusCompteDeBilan('467000', 'engagement', '455000')).toBeNull()
    expect(refusCompteDeBilan('455000', 'tresorerie', '108000')).toBeNull()
    expect(refusCompteDeBilan('108100', 'engagement', '455000')).toContain('« Virement personnel »')
  })

  it('l’impôt sur les bénéfices se paie au 444 en engagement, pas en trésorerie', () => {
    expect(refusCompteDeBilan('444000', 'engagement', '455000')).toBeNull()
    expect(refusCompteDeBilan('444000', 'tresorerie', '108000')).toContain('En comptabilité de trésorerie')
    expect(refusCompteDeBilan('431000', 'engagement', '455000')).toContain('paie, impôts et taxes')
  })

  // La base refuse elle-même tout ce que sa contrainte de forme n'admet pas : un compte que l'application accepte doit
  // donc la satisfaire, sans quoi l'écran proposerait un clic que la base refuserait avec le nom d'une contrainte.
  it('tout compte accepté satisfait la contrainte de forme de la colonne', () => {
    const migration = fichiersDuSchema().map((f) => f.texte).find((t) => t.includes('lignes_bancaires_compte_bilan_format'))!
    const contrainte = /compte_bilan ~ '([^']+)' and compte_bilan !~ '([^']+)'/.exec(migration)
    expect(contrainte).not.toBeNull()
    const [, forme, interdit] = contrainte!
    for (const compte of batterie()) {
      for (const mode of MODES) {
        if (compte != null && refusCompteDeBilan(compte, mode, '455000') === null) {
          expect(new RegExp(forme).test(compte), compte).toBe(true)
          expect(new RegExp(interdit).test(compte), compte).toBe(false)
        }
      }
    }
  })
})

describe('refusMouvementCompteDeBilan — le mouvement, avant le compte, dans l’ordre de la base', () => {
  const sql = sansApostrophes(definitionSql('ecrire_mouvement_compte_bilan'))

  it('un règlement groupé, tout autre lien, un mouvement de zéro euro, puis le compte', () => {
    const cas: [MouvementBancaire, string][] = [
      [mouvement({ reglement_groupe: true, statut: 'rapprochee' }), REFUS_REGLE_EN_GROUPE],
      [mouvement({ piece_id: 'p1', statut: 'rapprochee' }), REFUS_COMPTE_DE_BILAN_CLASSE],
      [mouvement({ montant: 0 }), 'Un mouvement de zéro euro n’a rien à écrire.'],
    ]
    let position = -1
    for (const [ligne, attendu] of cas) {
      expect(refusMouvementCompteDeBilan(ligne)).toBe(attendu)
      const ici = sql.indexOf(sansApostrophes(attendu))
      expect(ici, attendu).toBeGreaterThan(position)
      position = ici
    }
    // Le compte se juge ensuite : la fonction appelle `refus_compte_de_bilan` après ces trois refus.
    expect(sql.indexOf('public.refus_compte_de_bilan(p_compte, v_mode, v_dirigeant)')).toBeGreaterThan(position)
  })

  it('chaque lien que la base nomme refuse le mouvement', () => {
    for (const o of [
      { piece_id: 'p1' }, { cotisation_id: 'c1' }, { categorie_id: 'cat' }, { emprunt_id: 'e1', emprunt_echeance: 1 },
      { ventilee: true }, { prelevement_personnel: true, statut: 'ignoree' as const },
    ] satisfies Partial<MouvementBancaire>[]) {
      expect(refusMouvementCompteDeBilan(mouvement({ statut: 'rapprochee', ...o })), JSON.stringify(o)).toBe(REFUS_COMPTE_DE_BILAN_CLASSE)
    }
    expect(sql).toContain('v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null')
    expect(sql).toContain('or v_ligne.emprunt_id is not null or v_ligne.ventilee or v_ligne.prelevement_personnel then')
  })

  it('rien à redire d’un mouvement à traiter, ignoré, ou déjà écrit sur un compte de bilan — il se réécrit', () => {
    for (const o of [
      {}, { statut: 'ignoree' as const }, { statut: 'rapprochee' as const, compte_bilan: COMPTE_VIREMENTS_INTERNES },
    ] satisfies Partial<MouvementBancaire>[]) {
      expect(refusMouvementCompteDeBilan(mouvement(o))).toBeNull()
    }
  })

  it('le compte se juge avec le compte du dirigeant du dossier, que la base lit de même', () => {
    expect(refusCompteDeBilanDuMouvement(mouvement(), '455000', TRESORERIE)).toBeNull()
    expect(refusCompteDeBilanDuMouvement(mouvement(), '455000', ENGAGEMENT_SOCIETE)).toContain('(455000)')
    expect(refusCompteDeBilanDuMouvement(mouvement(), '108000', TRESORERIE)).toContain('(108000)')
    expect(refusCompteDeBilanDuMouvement(mouvement({ montant: 0 }), '512000', TRESORERIE)).toBe('Un mouvement de zéro euro n’a rien à écrire.')
    expect(refusCompteDeBilanDuMouvement(mouvement(), null, TRESORERIE)).toContain('six à dix chiffres')
    expect(sql).toContain("case when mode_comptable = 'engagement' then compte_notes_de_frais else '108000' end")
  })
})

describe('ecritureDuCompteDeBilan — le compte choisi face à la banque, dans le sens du mouvement', () => {
  it('un virement vers l’épargne débite le 580000 et crédite la banque', () => {
    expect(ecritureDuCompteDeBilan(mouvement(), COMPTE_VIREMENTS_INTERNES)).toEqual([
      { compte: COMPTE_VIREMENTS_INTERNES, sens: 'debit', montant: 2000, libelle: 'VIR EPARGNE' },
      { compte: COMPTE_BANQUE, sens: 'credit', montant: 2000, libelle: 'VIR EPARGNE' },
    ])
  })

  it('un dépôt de garantie rendu crédite le 275000 et débite la banque', () => {
    const rendu = mouvement({ montant: 1200, libelle: 'VIR RESTITUTION DEPOT' })
    expect(ecritureDuCompteDeBilan(rendu, COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES)).toEqual([
      { compte: COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES, sens: 'credit', montant: 1200, libelle: 'VIR RESTITUTION DEPOT' },
      { compte: COMPTE_BANQUE, sens: 'debit', montant: 1200, libelle: 'VIR RESTITUTION DEPOT' },
    ])
  })

  it('est l’écriture que la base attend : la banque au montant et dans le sens du mouvement, le compte en face', () => {
    const sql = definitionSql('ecrire_mouvement_compte_bilan')
    expect(COMPTE_BANQUE).toBe('512000')
    expect(sql).toContain("select '512000'::text as compte, v_sens_banque as sens, abs(v_ligne.montant) as montant")
    expect(sql).toContain('select p_compte, v_sens_compte, abs(v_ligne.montant)')
    expect(sql).toContain("v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;")
    expect(sql).toContain("v_sens_compte := case when v_ligne.montant > 0 then 'credit' else 'debit' end;")
  })
})

describe('mouvementsSurUnCompteDeBilanDesynchronises — défensif : l’écriture qui ne suit plus son compte', () => {
  const ecrit = mouvement({ statut: 'rapprochee', compte_bilan: COMPTE_VIREMENTS_INTERNES })
  const juste = [
    ecriture({ id: 'e1' }),
    ecriture({ id: 'e2', compte: COMPTE_BANQUE, sens: 'credit' }),
  ]

  it('se tait sur l’écriture que la base a écrite', () => {
    expect(mouvementsSurUnCompteDeBilanDesynchronises(juste, [ecrit], null)).toEqual([])
  })

  it('dit l’écriture absente, sur un autre compte, d’un autre montant, dans l’autre sens ou à une autre date', () => {
    expect(mouvementsSurUnCompteDeBilanDesynchronises([], [ecrit], null)).toEqual([ecrit])
    for (const o of [
      { compte: COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES }, { montant: 1999.9 }, { sens: 'credit' as const }, { date: '2026-03-13' },
    ]) {
      const fausse = [ecriture({ id: 'e1', ...o }), juste[1]]
      expect(mouvementsSurUnCompteDeBilanDesynchronises(fausse, [ecrit], null), JSON.stringify(o)).toEqual([ecrit])
    }
  })

  it('ne regarde que les mouvements écrits sur un compte de bilan, hors d’un exercice validé', () => {
    expect(mouvementsSurUnCompteDeBilanDesynchronises([], [mouvement()], null)).toEqual([])
    // Rapprochés d'autre chose — une catégorie, une pièce —, ils ont leur propre contrôle : sans compte de bilan, il n'y
    // a pas d'écriture attendue ici, et les juger les dirait tous « à réécrire ».
    const affecte = mouvement({ id: 'l2', statut: 'rapprochee', categorie_id: 'cat' })
    const dUnePieceRapprochee = mouvement({ id: 'l3', statut: 'rapprochee', piece_id: 'p1' })
    expect(mouvementsSurUnCompteDeBilanDesynchronises([], [affecte, dUnePieceRapprochee], null)).toEqual([])
    expect(mouvementsSurUnCompteDeBilanDesynchronises([], [ecrit], '2026-12-31')).toEqual([])
    expect(mouvementsSurUnCompteDeBilanDesynchronises([], [ecrit], '2026-03-11')).toEqual([ecrit])
    // L'écriture d'une pièce qui désigne le même mouvement n'est pas la sienne.
    const dUnePiece = juste.map((e) => ({ ...e, piece_id: 'p1' }))
    expect(mouvementsSurUnCompteDeBilanDesynchronises(dUnePiece, [ecrit], null)).toEqual([ecrit])
  })
})

describe('idsMouvementsSurUnCompteDeBilan — ce que la moyenne du plan de trésorerie écarte', () => {
  it('les mouvements rapprochés d’un compte de bilan, et eux seuls', () => {
    const lignes = [
      mouvement({ id: 'a', statut: 'rapprochee', compte_bilan: COMPTE_VIREMENTS_INTERNES }),
      mouvement({ id: 'b', statut: 'rapprochee', categorie_id: 'cat' }),
      mouvement({ id: 'c' }),
    ]
    expect([...idsMouvementsSurUnCompteDeBilan(lignes)]).toEqual(['a'])
  })
})

describe('les autres classements refusent un mouvement écrit sur un compte de bilan', () => {
  const ecrit = mouvement({ statut: 'rapprochee', compte_bilan: '274100' })
  const attendu = 'Ce mouvement est écrit sur le compte 274100 (Prêts) : annule d’abord ce classement.'

  it('la phrase nomme le compte et son libellé', () => {
    expect(refusEcritSurUnCompteDeBilan(ecrit)).toBe(attendu)
    expect(refusEcritSurUnCompteDeBilan({ compte_bilan: COMPTE_VIREMENTS_INTERNES }))
      .toBe('Ce mouvement est écrit sur le compte 580000 (Virements internes) : annule d’abord ce classement.')
    expect(refusEcritSurUnCompteDeBilan({ compte_bilan: null })).toBeNull()
  })

  // La base les refuserait par sa contrainte d'un seul rapprochement, avec le nom de la contrainte pour toute raison :
  // chaque classement le dit avant le clic.
  it('affecter, classer en virement personnel, ventiler, régler en groupe, rapprocher d’un emprunt ou d’une cotisation', () => {
    const categorie = { id: 'cat', libelle: 'Frais bancaires', compte_comptable: '627000' }
    expect(refusAffectation(ecrit, categorie, false, null)).toBe(attendu)
    expect(refusVirementPersonnel(ecrit)).toBe(attendu)
    expect(refusVentilation(ecrit, [], [categorie], false)).toBe(attendu)
    expect(refusReglementGroupe(ecrit, [], [], new Map())).toBe(attendu)
    expect(refusEcheanceEmprunt(ecrit)).toBe(attendu)
    expect(refusRapprochementCotisation(ecrit, { montant_verse: null, montant_appele: 2000, montant_csg_crds: null }, 'tresorerie')).toBe(attendu)
  })
})

describe('un mouvement écrit sur un compte de bilan est justifié par le relevé', () => {
  it('son écriture sans pièce n’est pas une rupture, et il n’est pas « rapproché sans justificatif »', () => {
    const ecrit = { ...mouvement({ statut: 'rapprochee', compte_bilan: COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES }), cotisation_id: null }
    expect(mouvementJustifieParLeReleve(ecrit)).toBe(true)
    expect(mouvementRapprocheSansObjet(ecrit)).toBe(false)
    // Le garde symétrique : remis à traiter, il ne l'est plus.
    const remis = { ...ecrit, statut: 'non_rapprochee' as const, compte_bilan: null, declaration_tva_id: null }
    expect(mouvementJustifieParLeReleve(remis)).toBe(false)
    expect(mouvementRapprocheSansObjet({ ...ecrit, compte_bilan: null, declaration_tva_id: null })).toBe(true)
  })
})

describe('libelleDuCompteDeBilan et libelleDuPlanComptable — le nom d’un compte que rien d’autre ne nomme', () => {
  it('les comptes proposés, par l’application', () => {
    expect(libelleDuCompteDeBilan(COMPTE_VIREMENTS_INTERNES)).toBe('Virements internes')
    expect(libelleDuCompteDeBilan(COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES)).toBe('Dépôts et cautionnements versés')
  })

  it('le plus long préfixe connu du plan, puis le compte à deux chiffres, puis la classe', () => {
    expect(libelleDuPlanComptable('274100')).toBe('Prêts')
    expect(libelleDuPlanComptable('27410000')).toBe('Prêts')
    expect(libelleDuPlanComptable('277000')).toBe('Autres immobilisations financières')
    expect(libelleDuPlanComptable('550000')).toBe('Comptes financiers')
    expect(libelleDuPlanComptable('165000')).toBe('Dépôts et cautionnements reçus')
    expect(libelleDuPlanComptable('444000')).toBe('État — impôts sur les bénéfices')
  })

  it('rien hors des classes 1 à 5', () => {
    for (const compte of ['606100', '706000', '801000', '012345', '']) expect(libelleDuPlanComptable(compte), compte).toBeNull()
  })

  it('chaque compte qu’un mouvement peut recevoir a un nom', () => {
    for (const compte of batterie()) {
      if (compte != null && refusCompteDeBilan(compte, 'engagement', '455000') === null) {
        expect(libelleDuCompteDeBilan(compte), compte).toBeTruthy()
      }
    }
  })
})

describe('mouvementsIgnoresHorsFec — un mouvement ignoré n’est pas au FEC, et se dit', () => {
  const ignore = (o: Partial<MouvementBancaire> = {}) => mouvement({ statut: 'ignoree', ...o })

  it('les mouvements ignorés, pas les virements personnels, qui s’écrivent', () => {
    const lignes = [
      ignore({ id: 'a' }),
      ignore({ id: 'b', prelevement_personnel: true }),
      mouvement({ id: 'c' }),
      mouvement({ id: 'd', statut: 'rapprochee', compte_bilan: COMPTE_VIREMENTS_INTERNES }),
    ]
    expect(mouvementsIgnoresHorsFec(lignes, null, null).map((l) => l.id)).toEqual(['a'])
  })

  it('ni avant l’ouverture d’un dossier repris, que les à-nouveaux portent, ni dans un exercice validé', () => {
    const lignes = [ignore({ id: 'avant', date: '2025-12-31' }), ignore({ id: 'ouverture', date: '2026-01-01' })]
    expect(mouvementsIgnoresHorsFec(lignes, '2026-01-01', null).map((l) => l.id)).toEqual(['ouverture'])
    expect(mouvementsIgnoresHorsFec(lignes, null, '2025-12-31').map((l) => l.id)).toEqual(['ouverture'])
    expect(mouvementsIgnoresHorsFec(lignes, null, '2026-12-31')).toEqual([])
  })

  // Les deux sens à part : la somme nette cacherait un encaissement derrière un paiement du même montant.
  it('dit ce qu’ils emportent, un sens après l’autre, au centime', () => {
    const euros = (texte: string | undefined) => texte?.replace(/\s/g, ' ')
    expect(euros(montantsDesMouvementsIgnores([{ montant: 300 }, { montant: -120 }, { montant: -0.1 }, { montant: -0.2 }])))
      .toBe('300,00 € encaissés et 120,30 € payés')
    expect(euros(montantsDesMouvementsIgnores([{ montant: -50 }, { montant: 50 }]))).toBe('50,00 € encaissés et 50,00 € payés')
    expect(euros(montantsDesMouvementsIgnores([{ montant: -50 }]))).toBe('50,00 € payés')
    expect(euros(montantsDesMouvementsIgnores([{ montant: 1250.5 }]))).toBe('1 250,50 € encaissés')
    // Rien quand aucun ne porte de montant.
    expect(montantsDesMouvementsIgnores([{ montant: 0 }])).toBeUndefined()
    expect(montantsDesMouvementsIgnores([])).toBeUndefined()
  })
})
