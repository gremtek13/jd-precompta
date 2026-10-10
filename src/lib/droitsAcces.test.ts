import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUCUN_DROIT, CE_QUE_DISENT_LES_CASES, CE_QUE_DONNE_UN_ACCES, DOMAINES, changementApplique, definitionDe,
  demandeDeChangement, droitsDeLaLigne, droitsParDossier, droitsSur, libelleDeLaCase, messageDuRefus,
} from './droitsAcces'

// LES DROITS D'UN ACCÈS CLIENT (espace client, étape P1). Ce qui se garde ici : qu'un droit ne s'accorde jamais par défaut,
// qu'une case cliquée n'envoie que SON droit, et que le module, la migration et les écrans du client disent la même chose.
const MIGRATION = readFileSync(resolve(process.cwd(), 'supabase/schema/20261009224031_droits_des_acces_clients.sql'), 'utf8')

describe('les droits d’une ligne : seul « vrai » accorde', () => {
  it('lit les deux colonnes', () => {
    expect(droitsDeLaLigne({ droit_ventes: true, droit_banque: false })).toEqual({ ventes: true, banque: false })
    expect(droitsDeLaLigne({ droit_ventes: false, droit_banque: true })).toEqual({ ventes: false, banque: true })
  })

  it('une colonne absente, nulle ou d’un autre type ne donne rien — une ligne d’avant la migration non plus', () => {
    for (const valeur of [undefined, null, 'true', 1, 'oui', {}]) {
      expect(droitsDeLaLigne({ droit_ventes: valeur, droit_banque: valeur }), String(valeur)).toEqual({ ventes: false, banque: false })
    }
    expect(droitsDeLaLigne({})).toEqual({ ventes: false, banque: false })
    expect(droitsDeLaLigne(null)).toEqual({ ventes: false, banque: false })
    expect(droitsDeLaLigne(undefined)).toEqual({ ventes: false, banque: false })
  })
})

describe('les droits par dossier', () => {
  it('chaque accès donne les droits de SON dossier, et rien aux autres', () => {
    const droits = droitsParDossier([
      { dossier_id: 'd1', droit_ventes: true, droit_banque: false },
      { dossier_id: 'd2', droit_ventes: false, droit_banque: true },
      { dossier_id: 'd3' },
    ])
    expect(droits).toEqual({
      d1: { ventes: true, banque: false },
      d2: { ventes: false, banque: true },
      d3: { ventes: false, banque: false },
    })
    expect(droitsSur(droits, 'd1')).toEqual({ ventes: true, banque: false })
    expect(droitsSur(droits, 'd9')).toEqual(AUCUN_DROIT)
    expect(droitsSur(droits, null)).toEqual(AUCUN_DROIT)
    expect(droitsSur(droits, undefined)).toEqual(AUCUN_DROIT)
    expect(droitsSur(droits, '')).toEqual(AUCUN_DROIT)
  })

  it('deux lignes d’un même dossier (la base l’interdit) n’additionnent pas leurs droits : chacun doit être sur les deux', () => {
    expect(droitsParDossier([
      { dossier_id: 'd1', droit_ventes: true, droit_banque: true },
      { dossier_id: 'd1', droit_ventes: false, droit_banque: true },
    ])).toEqual({ d1: { ventes: false, banque: true } })
    expect(droitsParDossier([
      { dossier_id: 'd1', droit_ventes: false, droit_banque: false },
      { dossier_id: 'd1', droit_ventes: true, droit_banque: true },
    ])).toEqual({ d1: { ventes: false, banque: false } })
  })

  it('aucun accès, aucun droit', () => {
    expect(droitsParDossier([])).toEqual({})
  })

  it('les droits rendus pour un dossier inconnu sont une copie : les modifier ne touche pas l’absence de droit commune', () => {
    const rendus = droitsSur({}, 'd1')
    rendus.ventes = true
    expect(AUCUN_DROIT).toEqual({ ventes: false, banque: false })
    expect(droitsSur({}, 'd1')).toEqual({ ventes: false, banque: false })
  })
})

describe('une case cliquée n’envoie que son droit', () => {
  it('l’autre droit part nul, donc inchangé en base', () => {
    expect(demandeDeChangement('m1', 'ventes', true)).toEqual({ p_membership_id: 'm1', p_ventes: true, p_banque: null })
    expect(demandeDeChangement('m1', 'ventes', false)).toEqual({ p_membership_id: 'm1', p_ventes: false, p_banque: null })
    expect(demandeDeChangement('m2', 'banque', true)).toEqual({ p_membership_id: 'm2', p_ventes: null, p_banque: true })
    expect(demandeDeChangement('m2', 'banque', false)).toEqual({ p_membership_id: 'm2', p_ventes: null, p_banque: false })
  })

  it('les noms des paramètres sont ceux de la fonction en base, dans son ordre', () => {
    const signature = /create function public\.changer_droits_acces\(([^)]*)\)/.exec(MIGRATION)
    expect(signature, 'signature introuvable dans la migration').not.toBeNull()
    const parametres = signature![1].split(',').map((p) => p.trim().split(/\s+/)[0])
    expect(parametres).toEqual(Object.keys(demandeDeChangement('m', 'ventes', true)))
  })

  it('reconnaît l’accès rendu qui porte le droit demandé, et seulement lui', () => {
    expect(changementApplique({ id: 'm1', droit_ventes: true, droit_banque: false }, 'ventes', true)).toBe(true)
    expect(changementApplique({ id: 'm1', droit_ventes: true, droit_banque: false }, 'banque', false)).toBe(true)
    expect(changementApplique({ id: 'm1', droit_ventes: false, droit_banque: false }, 'ventes', true)).toBe(false)
    expect(changementApplique({ id: 'm1', droit_ventes: 'true' }, 'ventes', true)).toBe(false)
    expect(changementApplique({ id: 'm1' }, 'banque', false)).toBe(false)
    for (const rendu of [null, undefined, 'ok', true, 1]) expect(changementApplique(rendu, 'ventes', true), String(rendu)).toBe(false)
  })
})

describe('le module, la migration et les écrans disent la même chose', () => {
  it('chaque domaine a sa colonne en base : booléenne, non nulle, fausse par défaut', () => {
    for (const { colonne } of DOMAINES) {
      expect(MIGRATION, colonne).toContain(`add column ${colonne} boolean not null default false`)
    }
    expect(DOMAINES.map((d) => d.domaine)).toEqual(['ventes', 'banque'])
    expect(() => definitionDe('achats' as never)).toThrow('Domaine inconnu')
  })

  it('ce que l’écran dit d’un droit est ce que dit le commentaire de sa colonne en base', () => {
    for (const { colonne, libelle, ouvrira } of DOMAINES) {
      const commentaire = new RegExp(`comment on column public\\.memberships\\.${colonne} is\\s+'([^']*)'`).exec(MIGRATION)?.[1]
      expect(commentaire, colonne).toContain(`Le droit « ${libelle} » de cet accès (${ouvrira})`)
    }
  })

  it('les mots que client_du_dossier connaît sont les domaines du module, et « membre »', () => {
    const corps = /create function public\.client_du_dossier[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(MIGRATION)?.[1] ?? ''
    const mots = [...corps.matchAll(/when '(\w+)' then/g)].map((m) => m[1])
    expect(mots.sort()).toEqual(['banque', 'membre', 'ventes'])
    expect(corps).toMatch(/else false/)
  })

  // « Le client ne voit aucun changement » est une AFFIRMATION de l'onglet Accès : elle tient tant qu'aucun écran du client
  // ne lit un droit. Le jour où « Mes ventes » ou « Ma banque » arrive, ce test tombe, et la phrase avec lui.
  it('les écrans du client sont ceux que la phrase décrit, et aucun ne lit encore un droit', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const routesClient = [...app.matchAll(/<Route path="(\/[^"]+)" element=\{<(Client\w+) \/>\} \/>/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(routesClient).toEqual([
      '/accueil ClientHome', '/mes-pieces ClientUpload', '/mes-informations ClientInformations', '/ma-simulation ClientSimulation',
    ])
    const ecransClient = readdirSync(resolve(process.cwd(), 'src/pages')).filter((f) => /^Client\w+\.tsx$/.test(f) && !f.includes('.test.'))
    expect(ecransClient.sort()).toEqual(['ClientHome.tsx', 'ClientInformations.tsx', 'ClientSimulation.tsx', 'ClientUpload.tsx'])
    for (const fichier of [...ecransClient.map((f) => `src/pages/${f}`), 'src/components/Layout.tsx']) {
      const texte = readFileSync(resolve(process.cwd(), fichier), 'utf8')
      expect(texte, fichier).not.toMatch(/droit_ventes|droit_banque|droitsParDossier|droitsSur\b|droitsAcces/)
    }
  })

  it('les phrases de l’onglet disent ce qu’un accès donne aujourd’hui, et ce qu’une case n’y change pas', () => {
    expect(CE_QUE_DONNE_UN_ACCES).toContain('dépose ses pièces et ses documents')
    expect(CE_QUE_DONNE_UN_ACCES).toContain('voit sa simulation')
    // L'ancienne phrase promettait « aucun accès aux montants » : la simulation en montre. Elle ne doit pas revenir.
    expect(CE_QUE_DONNE_UN_ACCES).not.toMatch(/montants|uniquement/)
    expect(CE_QUE_DISENT_LES_CASES).toContain('« Ventes » (devis, factures, facture électronique)')
    expect(CE_QUE_DISENT_LES_CASES).toContain('« Banque » (comptes, mouvements, connexion bancaire)')
    expect(CE_QUE_DISENT_LES_CASES).toContain('honorera quand ses écrans « Ventes » et « Banque » arriveront')
    expect(CE_QUE_DISENT_LES_CASES).toContain('cocher une case ne change pas ce que le client voit ou fait')
  })

  it('le nom d’une case et le message d’un refus nomment le droit et la personne', () => {
    expect(libelleDeLaCase('ventes', 'client@exemple.fr')).toBe('Droit « Ventes » de client@exemple.fr')
    expect(libelleDeLaCase('banque', 'client@exemple.fr')).toBe('Droit « Banque » de client@exemple.fr')
    expect(messageDuRefus('banque', 'client@exemple.fr', 'Accès refusé à ce dossier.'))
      .toBe('Le droit « Banque » de client@exemple.fr n’a pas été enregistré : Accès refusé à ce dossier.')
  })
})
