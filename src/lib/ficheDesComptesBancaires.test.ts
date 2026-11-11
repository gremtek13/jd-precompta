import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ceQuiResteModifiable, changements, comptesDesRolesDuPlan, confirmationDeLaCreation, confirmationDeLaModification, jugerLaCreation,
  jugerLaModification, PREMIERE_ANNEE_DU_COMPTE_PROPRE, REFUS_ANNEE_DU_COMPTE_PROPRE, REFUS_FIN_D_IDENTIFIANT,
  REFUS_OUVERTURE_A_LA_CREATION, REFUS_OUVERTURE_EFFACEE, saisieDuCompte, saisieNeuve, usageDesComptes, type SaisieDeLaFiche,
  type UsageDUnCompte,
} from './ficheDesComptesBancaires'
import { PLAN_PAR_DEFAUT } from './planComptable'
import type { CompteDuReleve } from './importParCompte'

// LA FICHE DES COMPTES BANCAIRES (ligne 26.6, MCB6) : ce que la saisie écrit, et le premier refus — de l'application, puis de
// la base (`refusDuCompteBancaire`, confronté au texte de la migration dans comptesBancaires.test.ts). Données FICTIVES.

const ROLES = comptesDesRolesDuPlan(PLAN_PAR_DEFAUT)
const PRINCIPAL: CompteDuReleve = { id: 'cb-p', libelle: 'Compte principal', principal: true, fin_d_identifiant: null, compte: null, compte_propre_depuis: null, ouvert_le: null, clos_le: null }
const SECOND: CompteDuReleve = { id: 'cb-2', libelle: 'Compte pro 2', principal: false, fin_d_identifiant: '4567', compte: '512100', compte_propre_depuis: '2026-01-01', ouvert_le: '2025-03-01', clos_le: null }
const VIDE: UsageDUnCompte = { mouvements: 0, releves: 0, premiere: null, derniere: null }
const PORTE: UsageDUnCompte = { mouvements: 3, releves: 1, premiere: '2025-03-04', derniere: '2026-02-10' }
const saisie = (o: Partial<SaisieDeLaFiche>): SaisieDeLaFiche => ({ libelle: 'Compte pro 3', compte: '512200', depuis: '2026', ouvertLe: '2026-02-01', closLe: '', finDIdentifiant: '', ...o })

describe('ce que la base porte sous chaque compte', () => {
  it('compte les mouvements et les relevés, et garde la première et la dernière date', () => {
    const u = usageDesComptes(
      [{ compte_bancaire_id: 'a', date: '2025-05-02' }, { compte_bancaire_id: 'a', date: '2025-01-03' }, { compte_bancaire_id: 'b', date: '2026-01-01' }, { compte_bancaire_id: null, date: '2024-01-01' }],
      [{ compte_bancaire_id: 'a' }, { compte_bancaire_id: 'c' }],
    )
    expect(u.get('a')).toEqual({ mouvements: 2, releves: 1, premiere: '2025-01-03', derniere: '2025-05-02' })
    expect(u.get('c')).toEqual({ mouvements: 0, releves: 1, premiere: null, derniere: null })
    expect(u.has('d')).toBe(false)
  })
})

describe('la création', () => {
  it('un dossier sans compte crée son principal : ni compte ni date à lui', () => {
    const s = saisieNeuve([], ROLES)
    expect(s).toMatchObject({ libelle: 'Compte principal', compte: '', depuis: '' })
    const j = jugerLaCreation({ ...s, ouvertLe: '2024-06-01' }, [], ROLES)
    expect(j).toEqual({ refus: null, ligne: { libelle: 'Compte principal', principal: true, compte: null, compte_propre_depuis: null, ouvert_le: '2024-06-01', clos_le: null, fin_d_identifiant: null } })
  })

  it('un autre compte : le premier 512x00 libre, depuis 2026', () => {
    expect(saisieNeuve([PRINCIPAL, SECOND], ROLES)).toMatchObject({ compte: '512200', depuis: String(PREMIERE_ANNEE_DU_COMPTE_PROPRE), libelle: '' })
    const j = jugerLaCreation(saisie({ finDIdentifiant: ' ab12 ' }), [PRINCIPAL, SECOND], ROLES)
    expect(j.ligne).toEqual({ libelle: 'Compte pro 3', principal: false, compte: '512200', compte_propre_depuis: '2026-01-01', ouvert_le: '2026-02-01', clos_le: null, fin_d_identifiant: 'AB12' })
  })

  it('la date d’ouverture se demande à la création (MCB4-Q2), et se lit au calendrier', () => {
    expect(jugerLaCreation(saisie({ ouvertLe: '' }), [PRINCIPAL], ROLES).refus).toBe(REFUS_OUVERTURE_A_LA_CREATION)
    expect(jugerLaCreation(saisie({ ouvertLe: '2026-02-30' }), [PRINCIPAL], ROLES).refus).toMatch(/^La date d’ouverture n’est pas une date du calendrier/)
    expect(jugerLaCreation(saisie({ closLe: '2026-13-01' }), [PRINCIPAL], ROLES).refus).toMatch(/^La date de clôture n’est pas/)
  })

  it('un compte propre avant 2026 se refuse (MCB-Q7), comme une année illisible', () => {
    expect(jugerLaCreation(saisie({ depuis: '2025' }), [PRINCIPAL], ROLES).refus).toBe(REFUS_ANNEE_DU_COMPTE_PROPRE)
    expect(jugerLaCreation(saisie({ depuis: '26' }), [PRINCIPAL], ROLES).refus).toBe(REFUS_ANNEE_DU_COMPTE_PROPRE)
    expect(jugerLaCreation(saisie({ depuis: '2027' }), [PRINCIPAL], ROLES).ligne?.compte_propre_depuis).toBe('2027-01-01')
  })

  it('la fin de l’identifiant : quatre chiffres ou lettres, comme la contrainte de la migration', () => {
    expect(jugerLaCreation(saisie({ finDIdentifiant: '45' }), [PRINCIPAL], ROLES).refus).toBe(REFUS_FIN_D_IDENTIFIANT)
    expect(jugerLaCreation(saisie({ finDIdentifiant: '45-6' }), [PRINCIPAL], ROLES).refus).toBe(REFUS_FIN_D_IDENTIFIANT)
    const migration = readFileSync('supabase/preparees/20261111153000_fin_d_identifiant_des_comptes_bancaires.sql', 'utf8')
    expect(migration).toContain("check (fin_d_identifiant ~ '^[0-9A-Z]{4}$')")
  })

  it('les refus de la base, aux mots de la base : le compte d’un rôle, celui d’un autre compte, la forme, la période', () => {
    expect(jugerLaCreation(saisie({ compte: '512000' }), [PRINCIPAL], ROLES).refus)
      .toBe("Le compte 512000 est celui du rôle « banque » du plan comptable du dossier : un compte bancaire tient un compte qui n'est qu'à lui.")
    expect(jugerLaCreation(saisie({ compte: '512100' }), [PRINCIPAL, SECOND], ROLES).refus).toBe('Le compte 512100 tient déjà un autre compte bancaire du dossier.')
    expect(jugerLaCreation(saisie({ compte: '51210' }), [PRINCIPAL], ROLES).refus).toMatch(/six chiffres qui commencent par 512 : « 51210 »/)
    expect(jugerLaCreation(saisie({ closLe: '2026-01-15' }), [PRINCIPAL], ROLES).refus).toBe('Un compte bancaire se clôt le jour de son ouverture ou après.')
    expect(jugerLaCreation(saisie({ libelle: '  ' }), [PRINCIPAL], ROLES).refus).toMatch(/^Un compte bancaire se nomme d'un libellé/)
  })
})

describe('la correction', () => {
  it('un compte qui porte des mouvements : son compte et sa date ne changent plus, aux mots de la base', () => {
    const j = jugerLaModification(SECOND, { ...saisieDuCompte(SECOND), compte: '512300' }, [PRINCIPAL, SECOND], ROLES, PORTE)
    expect(j.refus).toBe('Le compte bancaire « Compte pro 2 » porte déjà des mouvements ou des relevés : son compte du plan et la date depuis laquelle il le tient ne changent plus.')
    // Sans mouvement ni relevé, il se corrige.
    expect(jugerLaModification(SECOND, { ...saisieDuCompte(SECOND), compte: '512300' }, [PRINCIPAL, SECOND], ROLES, VIDE).ligne?.compte).toBe('512300')
  })

  it('l’ouverture et la clôture encadrent les mouvements ; l’ouverture ne s’efface pas', () => {
    expect(jugerLaModification(SECOND, { ...saisieDuCompte(SECOND), ouvertLe: '2025-04-01' }, [PRINCIPAL, SECOND], ROLES, PORTE).refus)
      .toMatch(/^Le compte bancaire « Compte pro 2 » porte des mouvements hors de la période/)
    expect(jugerLaModification(SECOND, { ...saisieDuCompte(SECOND), closLe: '2026-01-31' }, [PRINCIPAL, SECOND], ROLES, PORTE).refus)
      .toMatch(/hors de la période/)
    expect(jugerLaModification(SECOND, { ...saisieDuCompte(SECOND), ouvertLe: '' }, [PRINCIPAL, SECOND], ROLES, PORTE).refus).toBe(REFUS_OUVERTURE_EFFACEE)
    // Le principal créé par la base sans date la garde vide, et se renomme.
    const j = jugerLaModification(PRINCIPAL, { ...saisieDuCompte(PRINCIPAL), libelle: 'Compte courant' }, [PRINCIPAL, SECOND], ROLES, PORTE)
    expect(j.ligne).toMatchObject({ libelle: 'Compte courant', principal: true, compte: null, ouvert_le: null })
  })

  it('la fin de l’identifiant se corrige ou s’efface, sur un compte figé aussi ; ce qui change se nomme', () => {
    const corrige = jugerLaModification(SECOND, { ...saisieDuCompte(SECOND), finDIdentifiant: '9876' }, [PRINCIPAL, SECOND], ROLES, PORTE)
    expect(corrige.ligne?.fin_d_identifiant).toBe('9876')
    expect(changements(SECOND, corrige.ligne!)).toEqual(['fin_d_identifiant'])
    expect(confirmationDeLaModification(SECOND, corrige.ligne!, PORTE)).toBe('Corriger la fin de l’identifiant du compte « Compte pro 2 » ?')
    const efface = jugerLaModification(SECOND, { ...saisieDuCompte(SECOND), finDIdentifiant: '' }, [PRINCIPAL, SECOND], ROLES, PORTE)
    expect(efface.ligne?.fin_d_identifiant).toBeNull()
    expect(changements(SECOND, jugerLaModification(SECOND, saisieDuCompte(SECOND), [PRINCIPAL, SECOND], ROLES, PORTE).ligne!)).toEqual([])
  })
})

describe('les mots de la fiche', () => {
  it('la confirmation nomme ce qui se figera, et ce que la base permet encore', () => {
    const j = jugerLaCreation(saisie({}), [PRINCIPAL, SECOND], ROLES)
    expect(confirmationDeLaCreation(j.ligne!, '512000')).toBe('Créer le compte bancaire « Compte pro 3 », ouvert le 01/02/2026 ? Ses mouvements '
      + 's’écriront au 512200 depuis le 01/01/2026 (avant, au 512000 du compte principal). Son compte du plan et cette date se figeront à son '
      + 'premier mouvement ou relevé ; son nom, que le client « Banque » lit, reste modifiable. Un relevé de ce compte s’importe ensuite sous lui, dans l’onglet Banque.')
    expect(ceQuiResteModifiable(SECOND, PORTE)).toMatch(/ne changent plus ; son nom, ses dates d’ouverture et de clôture \(elles encadrent ses mouvements, du 04\/03\/2025 au 10\/02\/2026\)/)
    expect(ceQuiResteModifiable(SECOND, VIDE)).toMatch(/^Ce compte ne porte encore ni mouvement ni relevé : tout se corrige/)
    expect(confirmationDeLaModification(SECOND, { ...j.ligne!, libelle: SECOND.libelle, compte: '512100', clos_le: '2026-06-30', ouvert_le: SECOND.ouvert_le, fin_d_identifiant: '4567' }, PORTE))
      .toBe('Corriger la date de clôture du compte « Compte pro 2 » ? Clos le 30/06/2026, il ne reçoit plus de mouvement daté après, et son solde compte pour zéro à la fin de l’exercice.')
  })

  it('les rôles du plan se lisent dans l’ordre du catalogue, la banque d’abord', () => {
    expect(ROLES[0]).toEqual({ role: 'banque', compte: '512000' })
  })
})
