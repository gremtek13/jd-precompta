import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MODELE_DU_CABINET_PREVU,
  TABLES_DU_MODELE_DU_CABINET,
  changementsDuModele,
  comptesDuModele,
  confirmationDeLApplication,
  confirmationDuModele,
  csvDuModele,
  modeleALaCreation,
  modeleAUnDossier,
  modeleDeLaReponse,
  refusDuModele,
  saisieDuModele,
  type LectureDuModele,
  type SaisieDuModele,
} from './modeleDuCabinet'
import { ROLES_COMPTABLES } from './planComptable'
import { ROLES_DE_LA_BASE } from '../test/rolesDeLaBase'
import type { LigneDuPlanReglee } from './planDepuisLaBalance'
import { PLAN_LU_PAR_DEFAUT } from '../test/modeles'

// Le drapeau du change (ligne 31, lib/rolesDuChange.ts), joué par un accesseur : sans demande, l'état réel (levé).
const drapeauDuChange = vi.hoisted(() => ({ leve: undefined as boolean | undefined }))
vi.mock('./rolesDuChange', async (original) => {
  const vrai = await original<typeof import('./rolesDuChange')>()
  return { ...vrai, get ECARTS_DE_REGLEMENT_PREVUS() { return drapeauDuChange.leve ?? vrai.ECARTS_DE_REGLEMENT_PREVUS } }
})
afterEach(() => { drapeauDuChange.leve = undefined })

// PC5 — LE MODÈLE DE PLAN DU CABINET (ligne 43 ; la migration `modele_de_plan_du_cabinet`, préparée le 12/11/2026). Le module
// redit avant le clic les refus de `regler_modele_du_cabinet` : ce test confronte chacun de ses mots au texte de la migration
// (une phrase changée d'un côté seulement le fait rougir), puis la lecture, la saisie telle qu'elle part, ce qui change, et ce
// que « Nouveau dossier » dit avant le clic. Les refus, l'ordre et l'application se rejouent en base :
// supabase/essais/modeleDuCabinet.sql.

const MIGRATION = readFileSync(new URL('../../supabase/schema/20261112134459_modele_de_plan_du_cabinet.sql', import.meta.url), 'utf8')
const CORPS = (() => {
  const debut = MIGRATION.indexOf('function public.regler_modele_du_cabinet(')
  const ouvre = MIGRATION.indexOf('$$', debut) + 2
  return MIGRATION.slice(ouvre, MIGRATION.indexOf('$$', ouvre))
})()
/** Les phrases des refus de la fonction, leurs apostrophes doublées rendues simples. */
const PHRASES = [...CORPS.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))

/** La phrase du module, ses valeurs remises en `%`, dans l'ordre : le gabarit que la fonction écrit. */
function gabarit(phrase: string, valeurs: string[]): string {
  let reste = phrase
  let sortie = ''
  for (const v of valeurs) {
    const i = reste.indexOf(v)
    if (i < 0) throw new Error(`« ${v} » absent de « ${phrase} »`)
    sortie += reste.slice(0, i) + '%'
    reste = reste.slice(i + v.length)
  }
  return sortie + reste
}

const ligne = (role: LigneDuPlanReglee['role'], compte: string, autres: Partial<LigneDuPlanReglee> = {}): LigneDuPlanReglee =>
  ({ role, compte, libelle: null, prefixe_auxiliaire: null, ...autres })

// La réponse de `modele_du_cabinet` : une ligne par rôle du catalogue de la base, les deux du change compris depuis leur
// migration (12/11/2026, src/test/rolesDeLaBase.ts).
function reponse(regles: Record<string, { compte: string; libelle?: string; prefixe?: string }> = {}, origine?: string) {
  return {
    data: ROLES_DE_LA_BASE.map((r) => ({
      role: r.role,
      compte: regles[r.role]?.compte ?? r.compteDefaut,
      libelle: regles[r.role]?.libelle ?? r.libelleDefaut,
      prefixe_auxiliaire: regles[r.role]?.prefixe ?? r.prefixeAuxiliaireDefaut,
      origine: origine ?? (r.role in regles ? 'modele_du_cabinet' : 'application'),
    })),
    error: null,
  }
}

describe('le drapeau et la table', () => {
  it('le drapeau est levé depuis la migration en production (12/11/2026) ; la table est celle que la migration crée', () => {
    expect(MODELE_DU_CABINET_PREVU).toBe(true)
    expect(TABLES_DU_MODELE_DU_CABINET).toEqual(['plan_comptable_cabinet'])
    expect(MIGRATION).toMatch(/create table public\.plan_comptable_cabinet \(/i)
  })
})

describe('les refus redits avant le clic sont ceux de regler_modele_du_cabinet, sous ses mots et dans son ordre', () => {
  const cas: [string, LigneDuPlanReglee[], string[], string[]][] = [
    ['six chiffres', [ligne('banque', '5121')], [], ['banque', '5121']],
    ['la racine', [ligne('banque', '531000')], [], ['banque', '512', '531000']],
    ['une catégorie commune, au bilan', [ligne('exploitant', '108100')], ['1081'], ['108100', 'exploitant', '1081']],
    ['une catégorie commune, aux indemnités', [ligne('indemnites_kilometriques', '625120')], ['625120'], ['625120', '625120']],
    ['le libellé', [ligne('banque', '512100', { libelle: '  ' })], [], ['banque']],
    ['un préfixe hors des tiers', [ligne('banque', '512000', { prefixe_auxiliaire: 'BQ' })], [], ['banque']],
    ['un préfixe hors de sa forme', [ligne('fournisseurs', '401000', { prefixe_auxiliaire: 'f9' })], [], ['fournisseurs', 'f9']],
    ['un préfixe partagé', [ligne('fournisseurs', '401000', { prefixe_auxiliaire: 'C' })], [], ['fournisseurs', 'clients', 'C']],
  ]
  for (const [nom, comptes, categories, valeurs] of cas) {
    it(nom, () => {
      const refus = refusDuModele(comptes, categories)
      expect(refus).not.toBeNull()
      expect(PHRASES).toContain(gabarit(refus!, valeurs))
    })
  }

  it('les rôles en double à des zéros près : un refus que le catalogue d’aujourd’hui rend impossible, sous les mots de la fonction', () => {
    // Aucune racine du catalogue n'en commence une autre : le refus 8 ne se rencontre pas (l'essai en base plante un rôle).
    expect(refusDuModele([ligne('banque', '512100')], [])).toBeNull()
    expect(PHRASES).toContain('Les rôles « % » et « % » se tiendraient sur le même compte (« % »), à des zéros près : un compte ne tient qu\'un rôle.')
  })

  it('l’ordre : six chiffres avant la racine, même plus loin dans la liste ; la première ligne fautive l’emporte', () => {
    expect(refusDuModele([ligne('banque', '531000'), ligne('caisse', '5300')], [])).toContain('« caisse » s\'écrit en six chiffres')
    expect(refusDuModele([ligne('banque', '5121'), ligne('caisse', '5300')], [])).toContain('« banque » s\'écrit en six chiffres')
  })

  it('le compte du catalogue ne se refuse pas sur une catégorie ; une catégorie d’un dossier n’est pas lue ici', () => {
    expect(refusDuModele([ligne('exploitant', '108000', { libelle: 'Compte de l’exploitant' })], ['108000'])).toBeNull()
    expect(refusDuModele([ligne('banque', '512100'), ligne('fournisseurs', '401100', { prefixe_auxiliaire: 'FO' })], ['606100'])).toBeNull()
  })

  it('un libellé de deux cents caractères passe, deux cent un non ; un caractère de contrôle non', () => {
    expect(refusDuModele([ligne('banque', '512100', { libelle: 'x'.repeat(200) })], [])).toBeNull()
    expect(refusDuModele([ligne('banque', '512100', { libelle: 'x'.repeat(201) })], [])).not.toBeNull()
    expect(refusDuModele([ligne('banque', '512100', { libelle: 'Banque\tprincipale' })], [])).not.toBeNull()
  })
})

describe('la lecture du modèle', () => {
  it('entier : les rôles réglés sont ceux d’origine « modele_du_cabinet », dans l’ordre du catalogue', () => {
    const lu = modeleDeLaReponse(reponse({ clients: { compte: '411100', prefixe: 'CL' }, banque: { compte: '512100', libelle: 'Banque principale' } }))
    expect(lu.motif).toBeNull()
    expect(lu.modele?.plan.banque).toBe('512100')
    expect(lu.modele?.prefixes.clients).toBe('CL')
    expect(lu.modele === null ? null : lu.regles).toEqual(['banque', 'clients'])
  })

  it('une origine inconnue, une réponse refusée ou incomplète : aucun modèle, son motif', () => {
    expect(modeleDeLaReponse(reponse({}, 'dossier')).motif).toMatch(/origine du rôle « banque » n’est pas lue/)
    expect(modeleDeLaReponse({ data: null, error: { message: 'Accès refusé à ce cabinet.' } }).motif).toMatch(/^modèle de plan refusé : Accès refusé/)
    expect(modeleDeLaReponse({ data: reponse().data.slice(1), error: null }).motif).toMatch(/^modèle de plan incomplet/)
  })
})

describe('la saisie telle qu’elle part', () => {
  const lu = modeleDeLaReponse(reponse()) as Extract<LectureDuModele, { motif: null }>
  const saisie = (changements: Partial<Record<keyof SaisieDuModele, Partial<NonNullable<SaisieDuModele[keyof SaisieDuModele]>>>>): SaisieDuModele => {
    const depart = saisieDuModele(lu.modele) as Record<string, NonNullable<SaisieDuModele[keyof SaisieDuModele]>>
    for (const [role, c] of Object.entries(changements)) depart[role] = { ...depart[role], ...c } as NonNullable<SaisieDuModele[keyof SaisieDuModele]>
    return depart as SaisieDuModele
  }

  it('le modèle lu, inchangé : rien ne part', () => {
    expect(comptesDuModele(saisieDuModele(lu.modele))).toEqual([])
  })

  it('seuls les rôles qui diffèrent du catalogue, sans blancs de bord ; un libellé vide ou égal au catalogue, nul ; un préfixe égal au catalogue, nul', () => {
    expect(comptesDuModele(saisie({
      banque: { compte: ' 512100 ', libelle: ' Banque principale ' },
      caisse: { libelle: '' },
      fournisseurs: { prefixe: 'F' },
      clients: { prefixe: 'CL' },
    }))).toEqual([
      ligne('banque', '512100', { libelle: 'Banque principale' }),
      ligne('clients', '411000', { prefixe_auxiliaire: 'CL' }),
    ])
  })

  it('ce qui change est nommé, compte, libellé et préfixe, et la confirmation dit qu’aucun dossier existant ne change', () => {
    const comptes = comptesDuModele(saisie({ banque: { compte: '512100', libelle: 'Banque principale' }, clients: { prefixe: 'CL' } }))
    const changements = changementsDuModele(comptes, lu.modele)
    expect(changements.map((c) => c.role)).toEqual(['banque', 'clients'])
    const texte = confirmationDuModele(changements)
    expect(texte).toContain('512000 « Banque » → 512100 « Banque principale »')
    expect(texte).toContain('(auxiliaires C…) → 411000 « Clients » (auxiliaires CL…)')
    expect(texte).toContain('Le modèle ne change aucun dossier existant')
  })
})

describe('« Nouveau dossier » dit avant le clic ce qu’il fera du modèle', () => {
  it('en lecture, il attend ; illisible, il crée sans lui et le dit ; vide, rien ; réglé, il l’applique et nomme les rôles', () => {
    expect(modeleALaCreation(null)).toEqual({ applique: false, phrase: 'Lecture du modèle de plan du cabinet…' })
    expect(modeleALaCreation({ modele: null, motif: 'modèle de plan refusé : X' }).phrase)
      .toBe('Le modèle de plan du cabinet n\'a pas pu être lu (modèle de plan refusé : X) : le dossier sera créé avec le plan de l\'application, sans le modèle.')
    expect(modeleALaCreation(modeleDeLaReponse(reponse())).applique).toBe(false)
    const regle = modeleALaCreation(modeleDeLaReponse(reponse({ banque: { compte: '512100' } })))
    expect(regle).toEqual({ applique: true, phrase: 'Le modèle de plan du cabinet s’appliquera au dossier créé : 1 rôle(s) réglé(s) (Banque 512100).' })
  })
})

describe('l’export d’un cabinet porte son modèle', () => {
  it('une ligne par rôle, le BOM, le point-virgule, l’origine', () => {
    const lu = modeleDeLaReponse(reponse({ banque: { compte: '512100', libelle: 'Banque; principale' } })) as Extract<LectureDuModele, { motif: null }>
    const csv = csvDuModele(lu)
    expect(csv.startsWith('﻿Rôle;Code du rôle;Compte;Libellé;Préfixe des auxiliaires;Origine\r\n')).toBe(true)
    const lignes = csv.trimEnd().split('\r\n')
    expect(lignes).toHaveLength(ROLES_DE_LA_BASE.length + 1)
    expect(lignes).toContain('Banque;banque;512100;"Banque; principale";;modèle du cabinet')
    expect(lignes).toContain('Clients;clients;411000;Clients;C;application')
  })
})

describe('« Appliquer le modèle du cabinet » sur un dossier existant (PC5b)', () => {
  const lecture = (regles: Record<string, { compte: string; libelle?: string; prefixe?: string }> = {}) => modeleDeLaReponse(reponse(regles))

  it('copie les rôles que la migration copie : ceux qui s’écartent du catalogue, jamais les autres', () => {
    expect(MIGRATION).toContain('not (m.compte = r.compte_defaut and m.libelle is null and m.prefixe_auxiliaire is null)')
    const lu = lecture({ banque: { compte: '512100', libelle: 'Banque principale' }, clients: { compte: '411000', prefixe: 'X' } })
    const offre = modeleAUnDossier(lu, PLAN_LU_PAR_DEFAUT, false)
    expect(offre.etat).toBe('a_appliquer')
    if (offre.etat !== 'a_appliquer') return
    expect(offre.regles).toBe(2)
    expect(offre.changements.map((c) => c.role)).toEqual(['banque', 'clients'])
  })

  it('dit avant le clic la lecture qui n’est pas revenue, le modèle illisible, le modèle vide, l’exercice validé et le plan à jour', () => {
    expect(modeleAUnDossier(null, PLAN_LU_PAR_DEFAUT, false)).toEqual({ etat: 'lecture', phrase: 'Lecture du modèle de plan du cabinet…' })
    expect(modeleAUnDossier({ modele: null, motif: 'modèle de plan refusé : X' }, PLAN_LU_PAR_DEFAUT, false))
      .toEqual({ etat: 'refus', phrase: 'Le modèle de plan du cabinet n’a pas pu être lu (modèle de plan refusé : X) : il ne s’applique pas à ce dossier.' })
    expect(modeleAUnDossier(lecture(), PLAN_LU_PAR_DEFAUT, false).etat).toBe('refus')
    expect(modeleAUnDossier(lecture({ banque: { compte: '512100' } }), PLAN_LU_PAR_DEFAUT, true))
      .toEqual({ etat: 'refus', phrase: 'Un exercice de ce dossier est validé : son plan ne change plus, le modèle ne peut pas lui être appliqué.' })
    const tenu = { ...PLAN_LU_PAR_DEFAUT, plan: { ...PLAN_LU_PAR_DEFAUT.plan, banque: '512100' } }
    expect(modeleAUnDossier(lecture({ banque: { compte: '512100' } }), tenu, false))
      .toEqual({ etat: 'refus', phrase: 'Le plan de ce dossier tient déjà le modèle du cabinet : il n’y a rien à appliquer.' })
  })

  it('la confirmation nomme le nombre de rôles et chaque compte qui change', () => {
    const lu = lecture({ banque: { compte: '512100', libelle: 'Banque principale' } })
    const offre = modeleAUnDossier(lu, PLAN_LU_PAR_DEFAUT, false)
    if (offre.etat !== 'a_appliquer') throw new Error('le geste devait s’offrir')
    expect(confirmationDeLApplication(offre.regles, offre.changements)).toBe(
      'Appliquer le modèle de plan du cabinet à ce dossier ? Un rôle s’écarte du plan de l’application ; ce compte change dans ce dossier :\n'
      + '– Banque : 512000 « Banque » → 512100 « Banque principale »\n'
      + 'Le plan ne se change plus dès que le dossier porte une écriture ou un à-nouveau.',
    )
    expect(confirmationDeLApplication(2, [offre.changements[0], offre.changements[0]])).toContain('2 rôles s’écartent')
  })
})

describe('les deux rôles du change dans le modèle du cabinet (ligne 31 ; drapeau ECARTS_DE_REGLEMENT_PREVUS)', () => {
  const DU_CHANGE = ['pertes_de_change', 'gains_de_change']
  const lire = () => modeleDeLaReponse(reponse()) as Extract<LectureDuModele, { motif: null }>

  it('drapeau levé : la saisie et le CSV portent les 34 rôles de la base, les deux du change compris', () => {
    expect(ROLES_DE_LA_BASE).toHaveLength(34)
    const lu = lire()
    const saisie = saisieDuModele(lu.modele)
    expect(Object.keys(saisie)).toHaveLength(34)
    expect(saisie.pertes_de_change).toEqual({ compte: '656000', libelle: 'Pertes de change sur créances et dettes commerciales', prefixe: '' })
    expect(saisie.gains_de_change?.compte).toBe('756000')
    const lignes = csvDuModele(lu).trimEnd().split('\r\n')
    expect(lignes).toHaveLength(35)
    expect(lignes).toContain('Pertes de change sur créances et dettes commerciales;pertes_de_change;656000;Pertes de change sur créances et dettes commerciales;;application')
    expect(lignes).toContain('Gains de change sur créances et dettes commerciales;gains_de_change;756000;Gains de change sur créances et dettes commerciales;;application')
    expect(comptesDuModele(saisie)).toEqual([])
  })

  it('drapeau levé : un compte du change choisi sous l’autre racine part, et se lit comme réglé par le modèle', () => {
    const lu = modeleDeLaReponse(reponse({ pertes_de_change: { compte: '666000', libelle: 'Pertes de change' } }))
    expect(lu.motif).toBeNull()
    expect(lu.modele === null ? null : lu.regles).toEqual(['pertes_de_change'])
    const saisie = saisieDuModele(lu.modele!)
    expect(comptesDuModele(saisie)).toEqual([ligne('pertes_de_change', '666000', { libelle: 'Pertes de change' })])
    expect(csvDuModele(lu as Extract<LectureDuModele, { motif: null }>)).toContain('pertes_de_change;666000;Pertes de change;;modèle du cabinet')
    const changements = changementsDuModele(comptesDuModele(saisie), lire().modele)
    expect(changements.map((c) => c.role)).toEqual(['pertes_de_change'])
  })

  const cas: [string, string, string, string[]][] = [
    ['pertes_de_change', '600000', '656 ou 666', ['pertes_de_change', '656 ou 666', '600000']],
    ['gains_de_change', '706000', '756 ou 766', ['gains_de_change', '756 ou 766', '706000']],
    ['pertes_de_change', '756000', '656 ou 666', ['pertes_de_change', '656 ou 666', '756000']],
  ]
  for (const [role, compte, racines, valeurs] of cas) {
    it(`drapeau levé : « ${compte} » pour « ${role} » se refuse avant le clic, aux mots de la base`, () => {
      const refus = refusDuModele([ligne(role as LigneDuPlanReglee['role'], compte)], [])
      expect(refus).toBe(`Le compte du rôle « ${role} » commence par sa racine du plan comptable (${racines}) : « ${compte} » n'en est pas un.`)
      expect(PHRASES).toContain(gabarit(refus!, valeurs))
    })
  }

  it('drapeau levé : les quatre racines du change passent, et deux rôles du change ne se tiennent pas sur un même compte', () => {
    for (const [role, compte] of [['pertes_de_change', '656000'], ['pertes_de_change', '666000'], ['gains_de_change', '756000'], ['gains_de_change', '766000']] as const) {
      expect(refusDuModele([ligne(role, compte)], [])).toBeNull()
    }
    expect(refusDuModele([ligne('pertes_de_change', '656100'), ligne('gains_de_change', '756100')], [])).toBeNull()
  })

  it('drapeau baissé : rien ne change — 32 rôles, un CSV de 33 lignes, aucun rôle du change lu ni réglé', () => {
    drapeauDuChange.leve = false
    const lu = lire()
    const saisie = saisieDuModele(lu.modele)
    expect(Object.keys(saisie)).toHaveLength(ROLES_COMPTABLES.length)
    for (const role of DU_CHANGE) expect(role in saisie).toBe(false)
    expect(csvDuModele(lu).trimEnd().split('\r\n')).toHaveLength(ROLES_COMPTABLES.length + 1)
    expect(csvDuModele(lu)).not.toContain('_de_change')
    expect(comptesDuModele(saisie)).toEqual([])
    const lire2 = () => modeleDeLaReponse(reponse({ pertes_de_change: { compte: '666000' } })) as Extract<LectureDuModele, { motif: null }>
    expect(lire2().regles).toEqual([])
    expect(changementsDuModele([], PLAN_LU_PAR_DEFAUT)).toEqual([])
  })
})
