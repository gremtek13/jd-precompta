import { describe, expect, it } from 'vitest'
import {
  CODE_AVANT_D_AFFAIBLIR, DEUX_FACTEURS_EXIGES_EXPORTE, casesDesAcces, compteLu, confirmationDuGeste, exigenceRecommandee,
  gestesDuCompte, monExigenceLue, porteDeLExigence, refusDuGesteAvantLeClic, type CompteDeuxFacteurs,
} from './deuxFacteursExiges'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// La migration, préparée (supabase/preparees/) ou dans l'export sous la version de son application : le même texte.
const FICHIERS = [...fichiersDuSchema(), ...fichiersPrepares()]
const SQL = FICHIERS.find((f) => /\d{14}_deux_facteurs_exiges\.sql$/.test(f.chemin))?.texte ?? ''
/**
 * La DERNIÈRE définition d'une fonction, exportée puis préparée, dans l'ordre où elles s'appliquent — celle que la base
 * exécutera : une migration qui la redéfinirait sans le refus de SEC2-Q2 se verrait. De `create` à la fin du corps.
 */
const corps = (nom: string) => {
  const motif = new RegExp(`create (or replace )?function public\\.${nom}\\(`, 'g')
  let dernier = ''
  for (const f of FICHIERS) {
    const debuts = [...f.texte.matchAll(motif)].map((m) => m.index)
    if (debuts.length > 0) {
      const debut = debuts[debuts.length - 1]
      dernier = f.texte.slice(debut, f.texte.indexOf('$$;', debut))
    }
  }
  return dernier
}
// Une apostrophe se double en SQL, se courbe à l'écran : comparées, elles sont la même.
const sansApostrophes = (s: string) => s.replace(/''/g, "'").replace(/’/g, "'")
const CONDITION = "if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then"

const LIGNE = {
  user_id: 'u1', email: 'membre@essai.invalid', genre: 'membre', a_un_facteur: true, exigee_depuis: null,
  dernier_retrait: null, peut_exiger: true, peut_lever: true, peut_retirer: true,
}
const compte = (p: Partial<CompteDeuxFacteurs> = {}): CompteDeuxFacteurs => ({ ...(compteLu(LIGNE) as CompteDeuxFacteurs), ...p })

describe('la double authentification exigée — la règle (C7, second temps)', () => {
  it('le drapeau est baissé tant que la migration n’est pas en base', () => {
    expect(DEUX_FACTEURS_EXIGES_EXPORTE).toBe(false)
  })

  it('une ligne d’une autre forme ne se lit pas : la liste entière se dira illisible', () => {
    expect(compteLu(LIGNE)?.userId).toBe('u1')
    for (const faute of [{ genre: 'chef_inconnu' }, { a_un_facteur: 'oui' }, { email: 3 }, { user_id: null }, { peut_lever: undefined }]) {
      expect(compteLu({ ...LIGNE, ...faute }), JSON.stringify(faute)).toBeNull()
    }
    expect(compteLu(null)).toBeNull()
  })

  it('les gestes : ce que la base permet, et ce que l’état du compte rend utile', () => {
    expect(gestesDuCompte(compte())).toEqual(['exiger', 'retirer'])
    expect(gestesDuCompte(compte({ aUnFacteur: false }))).toEqual([])
    expect(gestesDuCompte(compte({ exigeeDepuis: '2026-11-07T10:00:00Z' }))).toEqual(['lever', 'retirer'])
    expect(gestesDuCompte(compte({ exigeeDepuis: '2026-11-07T10:00:00Z', aUnFacteur: false }))).toEqual(['lever'])
    expect(gestesDuCompte(compte({ peutExiger: false, peutLever: false, peutRetirer: false }))).toEqual([])
  })

  it('SEC-Q1 et SEC-Q2 : le cabinet toujours ; un client pour « Ventes », « Banque », « Achats » ou « Documents », pas « Caisse » seule', () => {
    expect(exigenceRecommandee({ genre: 'chef' }, null)).toBe(true)
    expect(exigenceRecommandee({ genre: 'membre' }, null)).toBe(true)
    expect(exigenceRecommandee({ genre: 'client' }, { caisse: true })).toBe(false)
    expect(exigenceRecommandee({ genre: 'client' }, { ventes: true })).toBe(true)
    expect(exigenceRecommandee({ genre: 'client' }, { documents: true, caisse: false })).toBe(true)
    expect(exigenceRecommandee({ genre: 'client' }, null)).toBe(false)
  })

  it('chaque confirmation nomme le compte et dit ce qui change pour lui', () => {
    expect(confirmationDuGeste('exiger', compte())).toContain('membre@essai.invalid')
    expect(confirmationDuGeste('lever', compte())).toContain('seul mot de passe')
    expect(confirmationDuGeste('retirer', compte({ exigeeDepuis: '2026-11-07T10:00:00Z' }))).toContain('inscrira un nouvel appareil')
    expect(confirmationDuGeste('retirer', compte())).toContain('seul mot de passe')
    expect(confirmationDuGeste('retirer', compte())).toContain('sessions fermées')
    // Ce que la base fait depuis la relecture adverse du 07/11/2026 : le jeton d'avant le retrait est refusé, aal2 compris.
    expect(confirmationDuGeste('retirer', compte())).toContain('la base refuse ce qu’elles demandent, même avec le code déjà donné')
  })

  it('les cases de chaque accès lu, par compte (SEC-Q2) : une colonne absente vaut faux, deux accès d’un compte se réunissent', () => {
    const cases = casesDesAcces([
      { user_id: 'u1', droit_banque: true, droit_ventes: false },
      { user_id: 'u2', droit_caisse: true },
      { user_id: 'u1', droit_documents: true, droit_banque: null },
    ])
    expect(cases.u1).toEqual({ ventes: false, banque: true, caisse: false, comptes: false, achats: false, frais: false, documents: true })
    expect(exigenceRecommandee({ genre: 'client' }, cases.u1)).toBe(true)
    expect(exigenceRecommandee({ genre: 'client' }, cases.u2)).toBe(false)
    expect(casesDesAcces([])).toEqual({})
  })

  it('la porte : drapeau baissé ou aal2, ouverte sans lecture ; exigé sans facteur, l’inscription ; illisible, fermée', () => {
    const lue = (exigee: boolean, satisfaite = !exigee) => ({ etat: 'lue' as const, valeur: { exigee, satisfaite, espace: 'client' as const } })
    expect(porteDeLExigence(false, 'aal1', lue(true), 'sans-facteur')).toBe('ouverte')
    expect(porteDeLExigence(true, 'aal2', { etat: 'lecture' }, 'verifie')).toBe('ouverte')
    expect(porteDeLExigence(true, 'aal1', { etat: 'lecture' }, 'sans-facteur')).toBe('lecture')
    expect(porteDeLExigence(true, 'aal1', { etat: 'illisible' }, 'sans-facteur')).toBe('illisible')
    expect(porteDeLExigence(true, 'aal1', lue(true), 'sans-facteur')).toBe('inscription')
    expect(porteDeLExigence(true, 'aal1', lue(true), 'code-a-donner')).toBe('ouverte')
    expect(porteDeLExigence(true, 'aal1', lue(false), 'sans-facteur')).toBe('ouverte')
    expect(porteDeLExigence(true, null, lue(true), 'sans-facteur')).toBe('inscription')
  })

  it('SEC2-Q2 : lever et retirer demandent le code de l’auteur (aal2) ; nul, le niveau se lit refusé ; exiger ne le demande pas', () => {
    expect(refusDuGesteAvantLeClic('lever', 'aal1')).toBe(CODE_AVANT_D_AFFAIBLIR)
    expect(refusDuGesteAvantLeClic('retirer', 'aal1')).toBe(CODE_AVANT_D_AFFAIBLIR)
    expect(refusDuGesteAvantLeClic('retirer', null)).toBe(CODE_AVANT_D_AFFAIBLIR)
    expect(refusDuGesteAvantLeClic('lever', 'aal2')).toBeNull()
    expect(refusDuGesteAvantLeClic('retirer', 'aal2')).toBeNull()
    expect(refusDuGesteAvantLeClic('exiger', 'aal1')).toBeNull()
    expect(refusDuGesteAvantLeClic('exiger', null)).toBeNull()
  })

  it('SEC2-Q2 dans la migration : lever et retirer refusent en 42501 aux mots de l’écran, après l’autorité, avant toute lecture ; exiger ne le demande pas', () => {
    expect(SQL, 'la migration deux_facteurs_exiges, préparée ou exportée').not.toBe('')
    const message = `Accès refusé : ${CODE_AVANT_D_AFFAIBLIR[0].toLowerCase()}${CODE_AVANT_D_AFFAIBLIR.slice(1)}`
    for (const nom of ['lever_deux_facteurs', 'retirer_second_facteur']) {
      const c = corps(nom)
      const autorite = c.indexOf('if not public.deux_facteurs_autorite(p_compte, true) then')
      const condition = c.indexOf(CONDITION)
      // La première lecture ou écriture qui suit : le verrou, puis la table ou GoTrue.
      const premiereLecture = Math.min(...['pg_advisory_xact_lock', 'update public.', 'delete from', 'insert into', 'select ']
        .map((m) => c.indexOf(m, autorite + 1)).filter((i) => i >= 0))
      expect(autorite, nom).toBeGreaterThan(0)
      expect(condition, nom).toBeGreaterThan(autorite)
      expect(condition, nom).toBeLessThan(premiereLecture)
      // Le refus de la condition, juste après elle : ces mots, en 42501.
      const refus = c.slice(condition, c.indexOf('end if;', condition))
      expect(sansApostrophes(refus), nom).toContain(`raise exception '${sansApostrophes(message)}'`)
      expect(refus, nom).toContain("using errcode = '42501'")
      expect(c.split(CONDITION).length - 1, nom).toBe(1)
    }
    expect(corps('exiger_deux_facteurs')).not.toBe('')
    expect(corps('exiger_deux_facteurs')).not.toContain("auth.jwt() ->> 'aal'")
  })

  it('ce que la porte lit se refuse sur une autre forme', () => {
    expect(monExigenceLue({ exigee: true, satisfaite: false, espace: 'cabinet' })).toEqual({ exigee: true, satisfaite: false, espace: 'cabinet' })
    expect(monExigenceLue({ exigee: 'oui', satisfaite: false, espace: null })).toBeNull()
    expect(monExigenceLue({ exigee: true, satisfaite: false, espace: 'equipe' })).toBeNull()
  })
})
