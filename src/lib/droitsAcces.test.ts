import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUCUN_DROIT, CE_QUE_DISENT_LES_CASES, CE_QUE_DONNE_UN_ACCES, DOMAINES, LIBELLE_MOTIF_AVOIR, LIBELLE_MOTIF_CONTRE_PASSATION,
  LIBELLE_ADRESSE_CONTACT, LIBELLE_DESCRIPTION_ARTICLE, LIBELLE_DESIGNATION_ARTICLE, LIBELLE_NOM_CONTACT, LIBELLE_NOTE_DECLARATION, LIBELLE_OBSERVATIONS_CONTACT, LIBELLE_NOTES_FACTURE, LIBELLE_QUESTION_MOUVEMENT, ceQueDisentLesCases, ceQueDonneUnAcces, changementApplique, definitionDe,
  demandeDeChangement, droitsDeLaLigne, droitsParDossier, droitsSur, libelleDeLaCase, messageDuRefus,
} from './droitsAcces'
import { ADRESSES_RECEPTION_EXPORTEES } from './adressesReception'
import { ARTICLES_EXPORTES } from './articles'
import { CONTACTS_EXPORTES } from './contacts'
import { IMPORT_CONTACTS_EXPORTE, LIGNES_PAR_IMPORT_MAX } from './contactsImport'
import { COUVERTURE_EXPORTEE } from './couvertureReleve'
import { VENTES_DU_CLIENT_EXPORTEES } from './encaissementsFactures'
import { contact } from '../test/contacts'
import { QUI_PEUT_QUOI_ATTENDU } from '../test/quiPeutQuoi'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

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
  // DEPUIS L'ÉTAPE P7, « Ma simulation » lit la case « Banque », et seulement derrière `COUVERTURE_EXPORTEE` — ce
  // qu'espaceClientAvantCouverture.test.tsx (drapeau faux) et ClientSimulation.banque.test.tsx (vrai) éprouvent sur l'écran
  // rendu. DEPUIS L'ÉTAPE P4a, « Mes ventes » lit la case « Ventes » — sa route et son entrée, derrière
  // `VENTES_DU_CLIENT_EXPORTEES` (lib/espaceVentes.ts, `mesVentesOuvertes`) —, et l'écran relit ses cases à la base. La phrase
  // de l'onglet suit les deux drapeaux (tests suivants).
  // DEPUIS L'ÉTAPE P9, « Ma banque » lit la case « Banque » — sa route, son entrée et sa tuile d'accueil, derrière
  // `COUVERTURE_EXPORTEE` (lib/banqueClient.ts, `maBanqueOuverte`) —, et l'écran relit sa case à la base.
  it('les écrans du client sont ceux que la phrase décrit : « Ma simulation » et « Ma banque » lisent « Banque », « Mes ventes » « Ventes », chacun derrière son drapeau', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const routesClient = [...app.matchAll(/<Route path="(\/[^"]+)" element=\{<(Client\w+) \/>\} \/>/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(routesClient).toEqual([
      '/accueil ClientHome', '/mes-pieces ClientUpload', '/mes-informations ClientInformations', '/ma-simulation ClientSimulation',
      '/mes-ventes ClientVentes', '/ma-banque ClientBanque',
    ])
    const ecransClient = readdirSync(resolve(process.cwd(), 'src/pages')).filter((f) => /^Client\w+\.tsx$/.test(f) && !f.includes('.test.'))
    expect(ecransClient.sort()).toEqual([
      'ClientBanque.tsx', 'ClientHome.tsx', 'ClientInformations.tsx', 'ClientSimulation.tsx', 'ClientUpload.tsx', 'ClientVentes.tsx',
    ])
    // DEPUIS L'ÉTAPE P4b, l'accueil lit la case « Ventes » pour ses tuiles « À encaisser » et « À déclarer » : la même garde
    // que la route, sur la société affichée, et rien d'autre ; les tuiles relisent leurs cases à la base.
    const accueil = readFileSync(resolve(process.cwd(), 'src/pages/ClientHome.tsx'), 'utf8')
    expect(accueil).toContain('mesVentesOuvertes(VENTES_DU_CLIENT_EXPORTEES, droitsSur(droitsParDossier ?? {}, dossierId).ventes)')
    // Et, depuis l'étape P9, la tuile « Ma banque » : la case « Banque » sous la garde de sa route, et rien d'autre.
    expect(accueil).toContain('maBanqueOuverte(COUVERTURE_EXPORTEE, droitsSur(droitsParDossier ?? {}, dossierId).banque)')
    expect(accueil).not.toMatch(/droit_ventes|droit_banque/)
    expect(accueil.match(/\.banque\b/g)).toHaveLength(1)
    expect(accueil.match(/droitsSur\(/g)).toHaveLength(2)
    // DEPUIS L'ÉTAPE A6b2, les cases se relisent à la base dans UNE lecture des ventes (`useVentesDuClient`), partagée par les tuiles
    // et l'encart « Facture électronique » : les tuiles ne lisent plus rien, l'encart ne lit que l'état de sa facture électronique.
    const lectureDesVentes = readFileSync(resolve(process.cwd(), 'src/lib/ventesDuClientLecture.ts'), 'utf8')
    expect(lectureDesVentes).toContain("supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId })")
    expect(lectureDesVentes).not.toMatch(/droit_ventes|droit_banque|droitsParDossier|droitsSur\b/)
    for (const fichier of ['TuilesVentesClient.tsx', 'AccueilVentesClient.tsx']) {
      const texte = readFileSync(resolve(process.cwd(), `src/pages/${fichier}`), 'utf8')
      expect(texte, fichier).not.toMatch(/droit_ventes|droit_banque|droitsParDossier|droitsSur\b|supabase/)
    }
    for (const fichier of ['ClientInformations.tsx', 'ClientUpload.tsx'].map((f) => `src/pages/${f}`)) {
      const texte = readFileSync(resolve(process.cwd(), fichier), 'utf8')
      expect(texte, fichier).not.toMatch(/droit_ventes|droit_banque|droitsParDossier|droitsSur\b|droitsAcces/)
    }
    const simulation = readFileSync(resolve(process.cwd(), 'src/pages/ClientSimulation.tsx'), 'utf8')
    expect(simulation).toContain('simulationOuverte(COUVERTURE_EXPORTEE, droitsSur(droitsParDossier ?? {}, dossierId).banque)')
    expect(simulation).not.toMatch(/droit_ventes|droit_banque|\.ventes\b/)
    // La route et l'entrée de « Mes ventes » lisent la case « Ventes » de la société AFFICHÉE, derrière le drapeau, et rien
    // d'autre ; l'écran, lui, relit ses cases à la base et ne lit pas celles d'AuthContext.
    const gardeVentes = 'mesVentesOuvertes(VENTES_DU_CLIENT_EXPORTEES, droitsSur(droitsParDossier ?? {}, dossierActifId).ventes)'
    expect(app).toContain(`{${gardeVentes} && <Route path="/mes-ventes" element={<ClientVentes />} />}`)
    const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.tsx'), 'utf8')
    expect(layout).toContain(gardeVentes)
    expect(layout).not.toMatch(/droit_ventes|droit_banque/)
    // « Ma banque » : la route et l'entrée lisent la case « Banque » de la société AFFICHÉE, derrière le drapeau, et rien
    // d'autre ; l'écran relit sa case à la base.
    const gardeBanque = 'maBanqueOuverte(COUVERTURE_EXPORTEE, droitsSur(droitsParDossier ?? {}, dossierActifId).banque)'
    expect(app).toContain(`{${gardeBanque} && <Route path="/ma-banque" element={<ClientBanque />} />}`)
    expect(layout).toContain(gardeBanque)
    expect(layout.match(/\.banque\b/g)).toHaveLength(1)
    const banque = readFileSync(resolve(process.cwd(), 'src/pages/ClientBanque.tsx'), 'utf8')
    expect(banque).toContain("supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId })")
    expect(banque).not.toMatch(/droit_ventes|droit_banque|droitsParDossier|droitsSur\b/)
    const ventes = readFileSync(resolve(process.cwd(), 'src/pages/ClientVentes.tsx'), 'utf8')
    expect(ventes).toContain("supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId })")
    expect(ventes).not.toMatch(/droit_ventes|droit_banque|droitsParDossier|droitsSur\b/)
  })

  it('la phrase de l’onglet dit ce qu’un accès donne — dans les deux états du drapeau de la banque', () => {
    // Avant que la couverture du relevé soit en base : la simulation, pour tout accès.
    expect(ceQueDonneUnAcces(false)).toContain('dépose ses pièces et ses documents')
    expect(ceQueDonneUnAcces(false)).toContain('voit sa simulation')
    // Après : la simulation suit la case « Banque » (EC-Q1, décidée).
    expect(ceQueDonneUnAcces(true)).toContain('dépose ses pièces et ses documents')
    // Et, depuis l'étape P9, « Ma banque » sous la même case.
    expect(ceQueDonneUnAcces(true)).toContain('avec la case « Banque », il voit aussi sa banque — les mouvements du relevé')
    expect(ceQueDonneUnAcces(true)).toContain('et sa simulation (chiffre d’affaires et cotisations estimés)')
    expect(ceQueDonneUnAcces(false)).not.toMatch(/sa banque —|relevé/)
    for (const etat of [false, true]) {
      // L'ancienne phrase promettait « aucun accès aux montants » : la simulation en montre. Elle ne doit pas revenir.
      expect(ceQueDonneUnAcces(etat)).not.toMatch(/montants|uniquement/)
      expect(ceQueDonneUnAcces(etat)).toContain('Les écritures, les catégories et les packs ne lui sont pas montrés.')
    }
    // Ce que l'onglet affiche est la phrase de l'état du drapeau.
    expect(CE_QUE_DONNE_UN_ACCES).toBe(ceQueDonneUnAcces(COUVERTURE_EXPORTEE))
  })

  it('le nom d’une case et le message d’un refus nomment le droit et la personne', () => {
    expect(libelleDeLaCase('ventes', 'client@exemple.fr')).toBe('Droit « Ventes » de client@exemple.fr')
    expect(libelleDeLaCase('banque', 'client@exemple.fr')).toBe('Droit « Banque » de client@exemple.fr')
    expect(messageDuRefus('banque', 'client@exemple.fr', 'Accès refusé à ce dossier.'))
      .toBe('Le droit « Banque » de client@exemple.fr n’a pas été enregistré : Accès refusé à ce dossier.')
  })
})

// CE QU'UNE CASE CHANGE, DANS LES QUATRE ÉTATS DES DEUX ÉTAPES (contrôle croisé P2 × P7, 10/10/2026). L'épingle d'avant ne
// connaissait que le drapeau de la banque : la migration des ventes appliquée, la phrase aurait gardé « cocher une case ne
// change pas ce que le client voit ou fait », ou « cocher « Ventes » ne change pas… » — faux dans les deux états de ce
// drapeau, puisque la base ouvre ses ventes à la SESSION du client, écran ou non. Chaque état est épinglé ici sur ce que la
// base ouvre alors, et ce qu'il nomme est confronté à l'export dès qu'il porte la migration qui l'ouvre.

// Ce que « Ventes » ouvre en LECTURE, tel que la phrase le nomme, et les tables que la migration ventes_du_client ouvre
// pour le dire (une policy `…_lecture_ventes` chacune).
const LU_AVEC_VENTES: Record<string, readonly string[]> = {
  'ses factures et avoirs': ['factures_emises', 'facture_lignes'],
  'leurs transmissions et leur suivi': ['transmissions_factures', 'facture_superpdp_events'],
  'les statuts lus sur sa plateforme': ['statuts_factures_recus'],
  'ses encaissements et leurs déclarations': ['encaissements_factures', 'encaissements_factures_taux', 'transmissions_encaissements'],
  'les e-mails qui les ont envoyés': ['emails_envoyes'],
}
// Ses GESTES, et les fonctions qui les font : chacune accepte, depuis les ventes du client, `gere_les_ventes`.
const GESTES_AVEC_VENTES: Record<string, readonly string[]> = {
  'créer, modifier, valider ou supprimer un brouillon': ['enregistrer_facture', 'supprimer_brouillon_facture'],
  'créer un avoir': ['enregistrer_facture'],
  'enregistrer, retirer, déclarer ou contre-passer un encaissement':
    ['enregistrer_encaissement', 'retirer_encaissement', 'declarer_encaissement_hors_application', 'annuler_encaissement'],
  'abandonner une transmission restée sans issue connue': ['abandonner_transmission'],
}
// Ce que « Banque » ouvre par la base depuis la migration banque_du_client (P7) : trois fonctions sous `gere_la_banque`.
const GESTES_AVEC_BANQUE: Record<string, readonly string[]> = {
  'proposer ou y retirer une pièce comme justificatif d’un mouvement': ['proposer_justificatif', 'retirer_proposition'],
  'y écrire des précisions sur un mouvement': ['ecrire_precision_mouvement'],
}
// Ce que « Ventes » ouvre dans les quatre fonctions de la vente (P3) : chaque geste nommé, et les actions qui le font. La
// table attendue est confrontée au texte des fonctions par droitsDeLAppelantCopie.test.ts.
type FonctionDeLaVente = keyof typeof QUI_PEUT_QUOI_ATTENDU
const GESTES_DES_FONCTIONS: Record<string, readonly (readonly [FonctionDeLaVente, string])[]> = {
  // Les relier, et voir leur état : « Mes ventes » le montre depuis l'étape P4a, et les relie depuis P4b (« Tes
  // plateformes », sous EC-Q4).
  'y relier lui-même sa plateforme agréée et Super PDP': [
    ['plateforme-agreee', 'enregistrer'], ['plateforme-agreee', 'tester'], ['plateforme-agreee', 'retirer'],
    ['superpdp-credentials', 'save'], ['superpdp-credentials', 'remove'],
  ],
  'et en voir l’état': [['plateforme-agreee', 'statut'], ['superpdp-credentials', 'status']],
  'y transmettre une facture et en suivre la transmission': [
    ['plateforme-agreee', 'deposer'], ['plateforme-agreee', 'suivre'], ['superpdp-emit', 'envoyer'],
    ['superpdp-emit', 'actualiser'],
  ],
  'relever les statuts de sa plateforme': [['plateforme-agreee', 'relever']],
  'envoyer une facture par e-mail, trente par dossier et par jour au plus': [['send-email', 'facture']],
}

describe('ce que disent les cases, dans les quatre états des deux étapes', () => {
  const PREFIXE = '« Ventes » (devis, factures, facture électronique) et « Banque » (comptes, mouvements, connexion bancaire) : '
  const ETATS = [
    { banque: false, ventes: false },
    { banque: true, ventes: false },
    { banque: false, ventes: true },
    { banque: true, ventes: true },
  ]

  it.each(ETATS)('banque ouverte : $banque, ventes ouvertes : $ventes — ce que la base ouvre, et rien d’autre', ({ banque, ventes }) => {
    const phrase = ceQueDisentLesCases(banque, ventes, false, false, false, false)
    expect(phrase.startsWith(PREFIXE)).toBe(true)
    const suite = phrase.slice(PREFIXE.length)
    // Les devis n'existent pas encore (étape P5) : seul le préfixe, qui dit ce que la case OUVRIRA, les nomme.
    expect(suite).not.toMatch(/devis/)
    expect(suite).toContain('une case cochée enregistre dès aujourd’hui un droit')

    if (!banque && !ventes) {
      // Aucune des deux étapes en base : rien ne change, quelle que soit la case — la phrase de l'étape P1, inchangée.
      expect(suite).toBe('une case cochée enregistre dès aujourd’hui un droit que l’espace du client honorera quand ses '
        + 'écrans « Ventes » et « Banque » arriveront. D’ici là, cocher une case ne change pas ce que le client voit ou fait.')
      return
    }
    expect(suite).not.toContain('cocher une case ne change pas')
    // Depuis l'étape P4a, « Mes ventes » existe avec les ventes ouvertes ; depuis l'étape P9, « Ma banque » avec la banque
    // ouverte : seuls l'écran qui manque et la connexion de sa banque par le client (étape P8) restent à venir.
    expect(suite.endsWith(banque
      ? (ventes
        ? ' La connexion de sa banque depuis son espace viendra ensuite.'
        : ' L’écran « Ventes » de son espace et la connexion de sa banque viendront ensuite.')
      : (ventes
        ? ' L’écran « Banque » de son espace viendra ensuite.'
        : ' Les écrans « Ventes » et « Banque » de son espace viendront ensuite.'))).toBe(true)
    // Plus rien ne se dit « sans écran » : les ventes ont « Mes ventes » (P4a, P4b), la banque « Ma banque » (P9).
    expect(suite).not.toMatch(/sans écran/)

    if (banque) {
      expect(suite).toContain('« Banque » ouvre au client « Ma banque », où il voit les mouvements du relevé')
      expect(suite).toContain('et le solde de ses relevés contrôlés')
      expect(suite).toContain('La case lui ouvre aussi sa simulation.')
      for (const geste of Object.keys(GESTES_AVEC_BANQUE)) expect(suite).toContain(geste)
    } else {
      expect(suite).not.toMatch(/simulation|contrôle de solde|justificatif|précisions/)
    }

    if (ventes) {
      expect(suite).toContain('« Ventes » ouvre au client « Mes ventes », où il lit ses ventes')
      for (const lu of Object.keys(LU_AVEC_VENTES)) expect(suite).toContain(lu)
      for (const geste of Object.keys(GESTES_AVEC_VENTES)) expect(suite).toContain(geste)
      for (const geste of Object.keys(GESTES_DES_FONCTIONS)) expect(suite).toContain(geste)
      // Ce que le cabinet y écrit est lu aussi : les libellés de ces champs le disent (plus bas).
      expect(suite).toContain('avec ce que le cabinet y a écrit (notes et motifs)')
      // Désigner le mouvement qui prouve un encaissement demande AUSSI « Banque » — seul effet de cette case sans P7.
      expect(suite).toContain(banque
        ? 'et, avec « Ventes », désigner celui qui prouve un encaissement.'
        : '« Banque » ne change encore qu’une chose, et seulement avec « Ventes » : le client peut désigner le mouvement '
          + 'du relevé qui prouve un encaissement.')
      expect(suite).not.toMatch(/ne change pas/)
    } else {
      expect(suite).not.toMatch(/encaissement|notes|factures|plateforme|Super PDP|e-mail/)
      expect(suite).toContain('Cocher « Ventes » ne change pas encore ce que le client voit ou fait.')
    }
  })

  it('les quatre états ont quatre phrases', () => {
    expect(new Set(ETATS.map(({ banque, ventes }) => ceQueDisentLesCases(banque, ventes, false, false, false, false))).size).toBe(4)
  })

  it('ce que l’onglet affiche est la phrase de l’état des six drapeaux', () => {
    expect(CE_QUE_DISENT_LES_CASES).toBe(ceQueDisentLesCases(
      COUVERTURE_EXPORTEE, VENTES_DU_CLIENT_EXPORTEES, ARTICLES_EXPORTES, ADRESSES_RECEPTION_EXPORTEES, CONTACTS_EXPORTES,
      IMPORT_CONTACTS_EXPORTE,
    ))
  })
})

// LES ADRESSES DE RÉCEPTION (espace client, étape A6a) : leur migration ouvre au client « Ventes », par la base, l'adresse
// de réception déclarée pour le dossier et son histoire, sa déclaration, et l'état de sa facture électronique, sans rien de
// secret — avant l'encart qui les montrera (étape A6b). Elle exige les migrations des ventes : sans elles, le drapeau ne
// change rien à la phrase. Ce que la phrase nomme est confronté à l'export dès qu'il porte la migration.
const LU_AVEC_ADRESSES: Record<string, readonly string[]> = {
  'l’adresse de réception de ses factures électroniques déclarée pour le dossier': ['adresses_reception'],
}
const GESTES_AVEC_ADRESSES: Record<string, readonly string[]> = {
  'peut la déclarer ou la remplacer avec toi': ['declarer_adresse_reception'],
  'l’état de sa facture électronique lui dit si': ['etat_facture_electronique'],
}

describe('ce que disent les cases, les adresses de réception ouvertes (étape A6a)', () => {
  it.each([false, true].flatMap((banque) => [false, true].map((articles) => ({ banque, articles }))))(
    'banque ouverte : $banque, articles : $articles — la phrase d’avant, puis l’adresse, son histoire, sa déclaration, l’état et leur encart',
    ({ banque, articles }) => {
      const avant = ceQueDisentLesCases(banque, true, articles, false, false, false)
      const phrase = ceQueDisentLesCases(banque, true, articles, true, false, false)
      // Rien de ce que la phrase disait ne se perd : les ventes et les articles, mot pour mot, puis la banque ; la phrase de ce
      // qui vient ensuite ne change PAS — l'encart (étape A6b2) est à l'écran, il n'est plus « à venir ».
      const finAvant = banque
        ? ' La connexion de sa banque depuis son espace viendra ensuite.'
        : ' L’écran « Banque » de son espace viendra ensuite.'
      const finPhrase = finAvant
      expect(avant.endsWith(finAvant)).toBe(true)
      const debutBanque = (texte: string) => texte.indexOf(banque ? ' « Banque » ouvre au client' : ' « Banque » ne change encore')
      const ajout = phrase.slice(debutBanque(avant), debutBanque(phrase))
      expect(phrase).toBe(avant.slice(0, debutBanque(avant)) + ajout + avant.slice(debutBanque(avant), -finAvant.length) + finPhrase)
      expect(ajout.startsWith(' Il lit aussi, avec son histoire, ')).toBe(true)
      for (const lu of Object.keys(LU_AVEC_ADRESSES)) expect(ajout).toContain(lu)
      for (const geste of Object.keys(GESTES_AVEC_ADRESSES)) expect(ajout).toContain(geste)
      // Tout ce que la base lui ouvre, l'auteur compris — et de l'état, rien de secret.
      expect(ajout).toContain('sa maille, son identifiant, sa plateforme, sa date de prise d’effet, où et quand elle a été '
        + 'vérifiée, et qui l’a déclarée')
      expect(ajout).toContain('si sa plateforme agréée et Super PDP sont reliés, leur nom et leurs dates, jamais leurs secrets.')
      // Depuis l'étape A6b1, la phrase dit OÙ l'adresse se lit et se déclare — « Tes plateformes », au-dessus de ses factures —,
      // et depuis l'étape A6b2 où l'état se montre : l'encart de son accueil, avec ce qui attend, qui mène à « Mes ventes ».
      expect(ajout).toContain('elle se lit et se déclare dans « Tes plateformes », au-dessus de ses factures')
      expect(ajout).toContain('L’encart « Facture électronique » de son accueil le dit, avec l’adresse et ce qui attend '
        + '— les encaissements à déclarer et les factures refusées sur sa plateforme —, et mène à « Mes ventes ».')
      // « ensuite » ne reste que pour ce qui est à venir : plus l'encart.
      expect(phrase).not.toMatch(/encart[^.]*ensuite/)
      // Aucun mot que le garde des écrans tient pour une affirmation avant lecture (ecransAvantLecture.test.tsx).
      expect(ajout).not.toMatch(/\b(aucun|aucune|rien)\b/i)
    },
  )

  it('sans les ventes, le drapeau des adresses ne change rien : leur migration exige celles des ventes', () => {
    for (const banque of [false, true]) {
      for (const articles of [false, true]) {
        expect(ceQueDisentLesCases(banque, false, articles, true, false, false)).toBe(ceQueDisentLesCases(banque, false, articles, false, false, false))
      }
      expect(ceQueDisentLesCases(banque, false, false, true, false, false)).not.toMatch(/adresse de réception|encart/)
    }
  })

  it('les dix états possibles ont dix phrases', () => {
    const phrases = [false, true].flatMap((banque) => [
      ceQueDisentLesCases(banque, false, false, false, false, false),
      ...[false, true].flatMap((articles) => [false, true].map((adresses) => ceQueDisentLesCases(banque, true, articles, adresses, false, false))),
    ])
    expect(new Set(phrases).size).toBe(10)
  })
})

// LES CONTACTS (espace client, étape A4a) : leur migration ouvre au client « Ventes », par la base, le fichier de ses
// clients — la lecture de la table de son dossier, effacés et retirés compris, et ses quatre gestes, l'effacement compris —,
// avant l'écran qui le montrera (étape A4b, « Mes ventes › Clients »). Elle exige les migrations des ventes : sans elles, le
// drapeau ne change rien à la phrase. Ce que la phrase nomme est confronté à l'export dès qu'il porte la migration, et les
// colonnes qu'elle dit lues, à celles d'un contact (`src/test/contacts.ts`, que contacts.test.ts confronte à l'essai).
const LU_AVEC_CONTACTS: Record<string, readonly string[]> = {
  'le fichier de ses clients': ['contacts'],
}
const GESTES_AVEC_CONTACTS: Record<string, readonly string[]> = {
  'peut créer, modifier, retirer, reprendre ou effacer un contact': [
    'enregistrer_contact', 'retirer_contact', 'reprendre_contact', 'effacer_contact',
  ],
}
// Chaque colonne d'un contact, et les mots qui la disent lue ; celles qui ne portent ni une donnée du client du client ni
// un auteur (la clé, le dossier, le genre, les instants) sont nommées à part, et toutes ensemble font la ligne.
const COLONNES_DITES: Record<string, string> = {
  nom: 'nom', type_client: 'type', adresse: 'adresse', siren: 'SIREN', siret: 'SIRET',
  adresse_electronique: 'adresse de facturation électronique', code_service: 'code service', email: 'e-mail',
  delai_paiement_jours: 'délai de paiement', observations: 'observations', cree_par: 'qui a créé', modifie_par: 'changé',
  retire_par: 'retiré', efface_par: 'effacé',
}
const COLONNES_SANS_MOT = ['id', 'dossier_id', 'genre', 'retire_le', 'efface_le', 'cree_le', 'modifie_le']

describe('ce que disent les cases, les contacts ouverts (étape A4a)', () => {
  const ETATS_DES_AUTRES = [false, true].flatMap((banque) => [false, true].flatMap((articles) => [false, true]
    .map((adresses) => ({ banque, articles, adresses }))))

  it.each(ETATS_DES_AUTRES)(
    'banque ouverte : $banque, articles : $articles, adresses : $adresses — la phrase d’avant, puis le fichier de ses clients, son écran, ses colonnes et ses gestes',
    ({ banque, articles, adresses }) => {
      const avant = ceQueDisentLesCases(banque, true, articles, adresses, false, false)
      const phrase = ceQueDisentLesCases(banque, true, articles, adresses, true, false)
      // Rien de ce que la phrase disait ne se perd : les ventes, les articles et les adresses, mot pour mot, puis la
      // banque ; la phrase de ce qui vient ensuite ne change PAS — l'écran de ses clients (étape A4b1) existe, il n'est plus
      // « à venir », comme celui de ses articles.
      const finAvant = banque
        ? ' La connexion de sa banque depuis son espace viendra ensuite.'
        : ' L’écran « Banque » de son espace viendra ensuite.'
      const finPhrase = finAvant
      expect(avant.endsWith(finAvant)).toBe(true)
      const debutBanque = (texte: string) => texte.indexOf(banque ? ' « Banque » ouvre au client' : ' « Banque » ne change encore')
      const ajout = phrase.slice(debutBanque(avant), debutBanque(phrase))
      expect(phrase).toBe(avant.slice(0, debutBanque(avant)) + ajout + avant.slice(debutBanque(avant), -finAvant.length) + finPhrase)
      expect(ajout.startsWith(' Il tient aussi avec toi, dans « Mes ventes › Clients » et par les fonctions de la base, le fichier de ses clients : ')).toBe(true)
      for (const lu of Object.keys(LU_AVEC_CONTACTS)) expect(ajout).toContain(lu)
      for (const geste of Object.keys(GESTES_AVEC_CONTACTS)) expect(ajout).toContain(geste)
      // Tout ce que la base lui ouvre, colonne par colonne, et les auteurs — effacés et retirés compris.
      const lues = ajout.slice(ajout.indexOf('il le lit en entier — '), ajout.indexOf(' — et peut'))
      for (const [colonne, mots] of Object.entries(COLONNES_DITES)) expect(lues, colonne).toContain(mots)
      // Ce que l'effacement fait, et ce qu'il ne fait pas : une facture garde la copie de son client.
      expect(ajout).toContain('effacer en vide les données, et une facture garde la copie qu’elle en a prise.')
      // L'écran existe depuis l'étape A4b1 : nommé comme le lieu où il le tient, plus jamais « à venir ».
      expect(phrase).not.toMatch(/Clients[^.]*(viendr|ensuite)/)
      // Aucun mot que le garde des écrans tient pour une affirmation avant lecture (ecransAvantLecture.test.tsx).
      expect(ajout).not.toMatch(/\b(aucun|aucune|rien)\b/i)
    },
  )

  it('les colonnes que la phrase dit lues, et celles qu’elle tait, font la ligne d’un contact', () => {
    expect([...Object.keys(COLONNES_DITES), ...COLONNES_SANS_MOT].sort()).toEqual(Object.keys(contact()).sort())
  })

  it('sans les ventes, le drapeau des contacts ne change rien : leur migration exige celles des ventes', () => {
    for (const { banque, articles, adresses } of ETATS_DES_AUTRES) {
      expect(ceQueDisentLesCases(banque, false, articles, adresses, true, false))
        .toBe(ceQueDisentLesCases(banque, false, articles, adresses, false, false))
      expect(ceQueDisentLesCases(banque, false, articles, adresses, true, false)).not.toMatch(/contact|clients/)
    }
  })

  it('les dix-huit états possibles ont dix-huit phrases', () => {
    const phrases = [false, true].flatMap((banque) => [
      ceQueDisentLesCases(banque, false, false, false, false, false),
      ...[false, true].flatMap((articles) => [false, true].flatMap((adresses) => [false, true]
        .map((contacts) => ceQueDisentLesCases(banque, true, articles, adresses, contacts, false)))),
    ])
    expect(new Set(phrases).size).toBe(18)
  })

  it('la case « Ventes » ouvre ce que la phrase nomme : le fichier de ses clients et ses gestes, sous la même case', () => {
    expect(ceQueDisentLesCases(true, true, true, true, true, false)).toContain('« Ventes » ouvre au client « Mes ventes »')
  })
})

// L'IMPORT DES CONTACTS (espace client, étape A4b3a) : sa migration ouvre au client « Ventes », par la base, un geste de plus
// sur le fichier de ses clients — importer d'un coup les lignes d'un fichier, d'un seul tenant, sans jamais modifier un
// contact rangé —, avant l'écran qui l'offrira (étape A4b3b). Elle exige celle des contacts : sans elle, ou sans les ventes,
// le drapeau ne change rien à la phrase. Ce que la phrase nomme est confronté à l'export dès qu'il porte la migration.
const GESTES_AVEC_IMPORT: Record<string, readonly string[]> = {
  'importer d’un coup la liste de clients de son ancien logiciel': ['importer_contacts'],
}
// La borne dite en lettres : celle du module (A4B3-Q1), que contactsImport.test.ts confronte à l'essai et à la fonction.
const BORNES_EN_LETTRES: Record<number, string> = { 500: 'cinq cents', 1000: 'mille', 2000: 'deux mille' }

describe('ce que disent les cases, l’import des contacts ouvert (étape A4b3a)', () => {
  const ETATS_DES_AUTRES = [false, true].flatMap((banque) => [false, true].flatMap((articles) => [false, true]
    .map((adresses) => ({ banque, articles, adresses }))))

  it.each(ETATS_DES_AUTRES)(
    'banque ouverte : $banque, articles : $articles, adresses : $adresses — la phrase des contacts, puis l’import, son étendue et son écran à venir',
    ({ banque, articles, adresses }) => {
      const avant = ceQueDisentLesCases(banque, true, articles, adresses, true, false)
      const phrase = ceQueDisentLesCases(banque, true, articles, adresses, true, true)
      // Rien de ce que la phrase disait ne se perd : l'import s'insère après le fichier de ses clients, avant la banque.
      const debutBanque = (texte: string) => texte.indexOf(banque ? ' « Banque » ouvre au client' : ' « Banque » ne change encore')
      const ajout = phrase.slice(debutBanque(avant), debutBanque(phrase))
      expect(phrase).toBe(avant.slice(0, debutBanque(avant)) + ajout + avant.slice(debutBanque(avant)))
      expect(avant.slice(0, debutBanque(avant)).endsWith('une facture garde la copie qu’elle en a prise.')).toBe(true)
      for (const geste of Object.keys(GESTES_AVEC_IMPORT)) expect(ajout).toContain(geste)
      // Son étendue : la borne du module, d'un seul tenant, et jamais un contact rangé modifié.
      expect(ajout).toContain(`, ${BORNES_EN_LETTRES[LIGNES_PAR_IMPORT_MAX]} lignes au plus, `)
      expect(ajout).toContain('d’un seul tenant : si une ligne est refusée, l’import entier l’est')
      expect(ajout).toContain('un contact déjà rangé n’est jamais modifié')
      // L'écran de l'import existe (étape A4b3b) : la phrase dit où, et que le fichier n'est pas gardé ; la fin de la phrase
      // entière ne change pas (l'égalité plus haut).
      expect(ajout.startsWith(' Dans « Mes ventes › Clients » (« Importer des clients ») comme par la base,')).toBe(true)
      expect(ajout.endsWith(' le fichier est lu dans son navigateur et n’est pas gardé.')).toBe(true)
      expect(ajout).not.toMatch(/viendr|ensuite/)
      // Aucun mot que le garde des écrans tient pour une affirmation avant lecture (ecransAvantLecture.test.tsx).
      expect(ajout).not.toMatch(/\b(aucun|aucune|rien)\b/i)
      // « Clients » n'y est suivi d'aucun « à venir » : l'écran des clients existe (étape A4b1).
      expect(phrase).not.toMatch(/Clients[^.]*(viendr|ensuite)/)
    },
  )

  it('sans les contacts ou sans les ventes, le drapeau de l’import ne change rien : sa migration exige celle des contacts', () => {
    for (const { banque, articles, adresses } of ETATS_DES_AUTRES) {
      for (const [ventes, contacts] of [[true, false], [false, true], [false, false]]) {
        expect(ceQueDisentLesCases(banque, ventes, articles, adresses, contacts, true))
          .toBe(ceQueDisentLesCases(banque, ventes, articles, adresses, contacts, false))
      }
      // « Importé » se dit déjà du relevé de la banque : l'import des contacts se reconnaît à ses propres mots.
      expect(ceQueDisentLesCases(banque, true, articles, adresses, false, true)).not.toMatch(/importer d’un coup|l’import\b/)
    }
  })

  it('les vingt-six états possibles ont vingt-six phrases', () => {
    const phrases = [false, true].flatMap((banque) => [
      ceQueDisentLesCases(banque, false, false, false, false, false),
      ...[false, true].flatMap((articles) => [false, true].flatMap((adresses) => [
        ceQueDisentLesCases(banque, true, articles, adresses, false, false),
        ceQueDisentLesCases(banque, true, articles, adresses, true, false),
        ceQueDisentLesCases(banque, true, articles, adresses, true, true),
      ])),
    ])
    expect(new Set(phrases).size).toBe(26)
  })

  it('la borne que la phrase dit en lettres est connue de la table : une autre borne, une autre phrase à écrire', () => {
    expect(BORNES_EN_LETTRES[LIGNES_PAR_IMPORT_MAX], `la borne ${LIGNES_PAR_IMPORT_MAX} n’a pas ses lettres`).toBeDefined()
  })

  // Le drapeau dit ce que porte l'export (contactsImport.test.ts le garde aussi) ; levé, le geste que la phrase nomme est une
  // fonction de l'export qui l'ouvre à « Ventes », l'accès d'abord, et la migration des contacts y est.
  it('l’import ouvert : le geste que la phrase nomme, l’export l’ouvre à « Ventes », l’accès d’abord', () => {
    const porte = (motif: RegExp) => fichiersDuSchema().some((f) => motif.test(f.texte))
    expect(porte(/create function public\.importer_contacts\(/), 'IMPORT_CONTACTS_EXPORTE ne dit plus ce que porte l’export')
      .toBe(IMPORT_CONTACTS_EXPORTE)
    if (!IMPORT_CONTACTS_EXPORTE) return
    expect(CONTACTS_EXPORTES, 'la migration de l’import exige celle des contacts').toBe(true)
    for (const fonction of Object.values(GESTES_AVEC_IMPORT).flat()) {
      expect(derniereDefinitionSql(fonction), fonction)
        .toMatch(/\$\$\s*(declare\s(?:(?!\bbegin\b)[\s\S])*)?\bbegin\s+(?:--[^\n]*\n\s*)*if not public\.gere_les_ventes\(p_dossier_id\) or not exists/)
    }
  })
})

// LES ARTICLES (espace client, étape A1) : leur migration ouvre au client « Ventes », par la base, la lecture du catalogue
// et ses trois gestes, sans écran encore (étape A2). Elle exige les migrations des ventes : sans elles, le drapeau des
// articles ne change rien à la phrase. Ce que la phrase nomme est confronté à l'export dès qu'il porte la migration.
const LU_AVEC_ARTICLES: Record<string, readonly string[]> = {
  'le catalogue des articles du dossier': ['articles'],
}
const GESTES_AVEC_ARTICLES: Record<string, readonly string[]> = {
  'créer, modifier, retirer ou reprendre un article': ['enregistrer_article', 'retirer_article', 'reprendre_article'],
}

describe('ce que disent les cases, les articles ouverts (étape A1)', () => {
  it.each([false, true])('banque ouverte : %s — la phrase des ventes, puis le catalogue, ses colonnes et ses gestes, et son écran à venir', (banque) => {
    const avant = ceQueDisentLesCases(banque, true, false, false, false, false)
    const phrase = ceQueDisentLesCases(banque, true, true, false, false, false)
    // Rien de ce que la phrase disait ne se perd : celle des ventes, celle de la banque, mot pour mot.
    const ventes = avant.slice(0, avant.indexOf(banque ? ' « Banque » ouvre au client' : ' « Banque » ne change encore'))
    expect(phrase.startsWith(ventes)).toBe(true)
    for (const lu of Object.keys(LU_AVEC_ARTICLES)) expect(phrase).toContain(lu)
    for (const geste of Object.keys(GESTES_AVEC_ARTICLES)) expect(phrase).toContain(geste)
    // Tout ce que la base lui ouvre, colonnes et auteurs compris — retirés compris —, et que le cabinet le tient avec lui
    // (MEG1-Q1, la décision du cabinet).
    expect(phrase).toContain('il le lit en entier — référence, désignation, description, unité, prix, taux de TVA, nature, '
      + 'et qui a créé, changé ou retiré chaque article —')
    // Depuis l'étape A2a, l'écran des articles existe : « Mes ventes › Articles » est nommé, et la phrase ne le dit plus à
    // venir — seuls la banque du client (P8) et l'écran « Banque » restent à venir, comme sans les articles.
    expect(phrase).toContain('Il tient aussi avec toi, dans « Mes ventes › Articles » et par les fonctions de la base,')
    expect(phrase).not.toMatch(/écran de ses articles|celui de ses articles/)
    expect(phrase.endsWith(banque
      ? ' La connexion de sa banque depuis son espace viendra ensuite.'
      : ' L’écran « Banque » de son espace viendra ensuite.')).toBe(true)
    // Les devis n'existent pas encore (étape P5) : seul le préfixe, qui dit ce que la case OUVRIRA, les nomme.
    expect(phrase).not.toMatch(/sans écran/)
    expect(phrase.slice(phrase.indexOf('une case cochée'))).not.toMatch(/devis/)
  })

  it('sans les ventes, le drapeau des articles ne change rien : leur migration exige celles des ventes', () => {
    for (const banque of [false, true]) {
      expect(ceQueDisentLesCases(banque, false, true, false, false, false)).toBe(ceQueDisentLesCases(banque, false, false, false, false, false))
      expect(ceQueDisentLesCases(banque, false, true, false, false, false)).not.toMatch(/article/)
    }
  })

  it('les six états possibles ont six phrases', () => {
    const phrases = [false, true].flatMap((banque) => [
      ceQueDisentLesCases(banque, false, false, false, false, false), ceQueDisentLesCases(banque, true, false, false, false, false), ceQueDisentLesCases(banque, true, true, false, false, false),
    ])
    expect(new Set(phrases).size).toBe(6)
  })

  it('la case « Ventes » ouvre ce que la phrase nomme : la lecture du catalogue et ses gestes, sous la même case', () => {
    expect(ceQueDisentLesCases(true, true, true, false, false, false)).toContain('« Ventes » ouvre au client « Mes ventes »')
  })
})

describe('ce que « Ventes » ouvre dans les fonctions de la vente (P3), confronté à leur table', () => {
  const nommees = Object.values(GESTES_DES_FONCTIONS).flat()

  it('chaque action que la phrase nomme, la table l’ouvre à « Ventes »', () => {
    for (const [fonction, action] of nommees) {
      expect((QUI_PEUT_QUOI_ATTENDU[fonction] as Record<string, string>)[action], `${fonction} › ${action}`).toBe('ventes')
    }
  })

  it('chaque action que la table ouvre à « Ventes », la phrase la nomme, et aucune du cabinet seul', () => {
    for (const [fonction, table] of Object.entries(QUI_PEUT_QUOI_ATTENDU)) {
      for (const [action, droit] of Object.entries(table)) {
        const nommee = nommees.some(([f, a]) => f === fonction && a === action)
        expect(nommee, `${fonction} › ${action}`).toBe(droit === 'ventes')
      }
    }
  })

  it('le plafond que la phrase dit est celui de send-email', () => {
    const source = readFileSync(resolve(process.cwd(), 'supabase/functions/send-email/index.ts'), 'utf8')
    expect(source.match(/const PLAFOND_CLIENT_PAR_JOUR = (\d+)\n/)?.[1]).toBe('30')
    expect(ceQueDisentLesCases(false, true, false, false, false, false)).toContain('trente par dossier et par jour au plus')
  })
})

describe('ce que disent les cases, confronté à l’export', () => {
  const fichiers = fichiersDuSchema()
  const porte = (motif: RegExp) => fichiers.some((f) => motif.test(f.texte))
  const premiereDesVentes = porte(/create policy factures_emises_lecture_ventes on public\.factures_emises\b/)
  const secondeDesVentes = porte(/create (or replace )?function public\.supprimer_brouillon_facture\(/)

  // LES DEUX MIGRATIONS DES VENTES S'EXPORTENT ENSEMBLE : la première ouvre la lecture et les encaissements, la seconde
  // les brouillons et leur validation ; la phrase lit le drapeau de la première et dit les deux. Un export qui porterait
  // l'une sans l'autre la ferait mentir, dans un sens ou dans l'autre.
  it('l’export porte les deux migrations des ventes, ou aucune, et le drapeau dit lequel', () => {
    expect(secondeDesVentes, 'une migration des ventes exportée sans l’autre').toBe(premiereDesVentes)
    expect(VENTES_DU_CLIENT_EXPORTEES, 'VENTES_DU_CLIENT_EXPORTEES ne dit plus ce que porte l’export').toBe(premiereDesVentes)
  })

  it('les ventes ouvertes : chaque table lue et chaque geste que la phrase nomme, l’export les ouvre à « Ventes »', () => {
    if (!premiereDesVentes) return
    const policies = [...fichiers.map((f) => f.texte).join('\n')
      .matchAll(/create policy \w+_lecture_ventes on public\.(\w+)\s+for select to authenticated\s+using \(([^;]*)\);/g)]
    for (const [, table, predicat] of policies) {
      expect(predicat, table).toMatch(/client_du_dossier\((f\.)?dossier_id, 'ventes'\)/)
    }
    // Depuis l'étape A1, la lecture des articles aussi, depuis l'étape A6a celle des adresses de réception, et depuis
    // l'étape A4a celle des contacts, le jour où l'export porte leur migration.
    expect(policies.map((p) => p[1]).sort()).toEqual([
      ...Object.values(LU_AVEC_VENTES).flat(),
      ...(ARTICLES_EXPORTES ? Object.values(LU_AVEC_ARTICLES).flat() : []),
      ...(ADRESSES_RECEPTION_EXPORTEES ? Object.values(LU_AVEC_ADRESSES).flat() : []),
      ...(CONTACTS_EXPORTES ? Object.values(LU_AVEC_CONTACTS).flat() : []),
    ].sort())
    for (const fonction of new Set(Object.values(GESTES_AVEC_VENTES).flat())) {
      expect(derniereDefinitionSql(fonction), fonction).toMatch(/if not public\.gere_les_ventes\((p_dossier_id|v_transmission\.dossier_id)\) then/)
    }
    expect(derniereDefinitionSql('enregistrer_encaissement'))
      .toContain('if p_ligne_bancaire_id is not null and not public.gere_la_banque(p_dossier_id) then')
  })

  it('la banque ouverte (P7) : le contrôle de solde et chaque geste que la phrase nomme, l’export les ouvre à « Banque »', () => {
    if (!COUVERTURE_EXPORTEE) return
    expect(porte(/create policy \w+ on public\.controles_releves_bancaires\s+for select to authenticated using \(client_du_dossier\(dossier_id, 'banque'\)\);/))
      .toBe(true)
    for (const fonction of Object.values(GESTES_AVEC_BANQUE).flat()) {
      expect(derniereDefinitionSql(fonction), fonction).toContain('if not public.gere_la_banque(p_dossier_id)')
    }
  })

  // LES ARTICLES (étape A1) : le drapeau dit ce que porte l'export (articles.test.ts le garde aussi) ; levé, la lecture que
  // la phrase nomme est ouverte au droit « Ventes », et chacun de ses gestes est une fonction qui l'accepte.
  it('les articles ouverts (A1) : la lecture du catalogue et chaque geste que la phrase nomme, l’export les ouvre à « Ventes »', () => {
    expect(porte(/create table public\.articles \(/), 'ARTICLES_EXPORTES ne dit plus ce que porte l’export').toBe(ARTICLES_EXPORTES)
    if (!ARTICLES_EXPORTES) return
    expect(premiereDesVentes, 'la migration des articles exige celles des ventes').toBe(true)
    for (const table of Object.values(LU_AVEC_ARTICLES).flat()) {
      expect(porte(new RegExp(`create policy ${table}_lecture_ventes on public\\.${table}\\s+for select to authenticated\\s+using \\(public\\.client_du_dossier\\(dossier_id, 'ventes'\\)\\);`)), table)
        .toBe(true)
    }
    for (const fonction of Object.values(GESTES_AVEC_ARTICLES).flat()) {
      expect(derniereDefinitionSql(fonction), fonction).toContain('if not public.gere_les_ventes(p_dossier_id)')
    }
  })

  // LES ADRESSES DE RÉCEPTION (étape A6a) : le drapeau dit ce que porte l'export (adressesReception.test.ts le garde
  // aussi) ; levé, la lecture que la phrase nomme est ouverte au droit « Ventes », et la déclaration comme l'état de la
  // facture électronique sont des fonctions qui l'acceptent, l'accès d'abord.
  it('les adresses de réception ouvertes (A6a) : leur lecture, leur déclaration et l’état, l’export les ouvre à « Ventes »', () => {
    expect(porte(/create table public\.adresses_reception \(/), 'ADRESSES_RECEPTION_EXPORTEES ne dit plus ce que porte l’export')
      .toBe(ADRESSES_RECEPTION_EXPORTEES)
    if (!ADRESSES_RECEPTION_EXPORTEES) return
    expect(premiereDesVentes, 'la migration des adresses de réception exige celles des ventes').toBe(true)
    for (const table of Object.values(LU_AVEC_ADRESSES).flat()) {
      expect(porte(new RegExp(`create policy ${table}_lecture_ventes on public\\.${table}\\s+for select to authenticated\\s+using \\(public\\.client_du_dossier\\(dossier_id, 'ventes'\\)\\);`)), table)
        .toBe(true)
    }
    for (const fonction of Object.values(GESTES_AVEC_ADRESSES).flat()) {
      // Le PREMIER `begin` du corps, sans rien entre lui et le contrôle d'accès.
      expect(derniereDefinitionSql(fonction), fonction)
        .toMatch(/\$\$\s*(declare\s(?:(?!\bbegin\b)[\s\S])*)?\bbegin\s+if not public\.gere_les_ventes\(p_dossier_id\) or not exists/)
    }
  })

  // LES CONTACTS (étape A4a) : le drapeau dit ce que porte l'export (contacts.test.ts le garde aussi) ; levé, la lecture
  // que la phrase nomme est ouverte au droit « Ventes », et chacun des quatre gestes est une fonction qui l'accepte,
  // l'accès d'abord.
  it('les contacts ouverts (A4a) : la lecture du fichier de ses clients et ses quatre gestes, l’export les ouvre à « Ventes »', () => {
    expect(porte(/create table public\.contacts \(/), 'CONTACTS_EXPORTES ne dit plus ce que porte l’export').toBe(CONTACTS_EXPORTES)
    if (!CONTACTS_EXPORTES) return
    expect(premiereDesVentes, 'la migration des contacts exige celles des ventes').toBe(true)
    for (const table of Object.values(LU_AVEC_CONTACTS).flat()) {
      expect(porte(new RegExp(`create policy ${table}_lecture_ventes on public\\.${table}\\s+for select to authenticated\\s+using \\(public\\.client_du_dossier\\(dossier_id, 'ventes'\\)\\);`)), table)
        .toBe(true)
    }
    for (const fonction of Object.values(GESTES_AVEC_CONTACTS).flat()) {
      // Le PREMIER `begin` du corps, sans rien entre lui et le contrôle d'accès.
      expect(derniereDefinitionSql(fonction), fonction)
        .toMatch(/\$\$\s*(declare\s(?:(?!\bbegin\b)[\s\S])*)?\bbegin\s+if not public\.gere_les_ventes\(p_dossier_id\) or not exists/)
    }
  })
})

// CE QUE LE CLIENT « VENTES » LIT DE LA MAIN DU CABINET (espace client, étape P2 ; conception, §3.6). Le cabinet a accepté
// les deux migrations des ventes, le 10/10/2026, à une condition remplie avant l'application : le libellé de chaque texte
// libre qu'il saisit dans une table que « Ventes » ouvre dit que le client qui porte la case le lit. Les écrans les
// montrent (FactureFormModal, FactureAvoirModal et EncaissementsFactureModal, leurs tests).
describe('ce que le client « Ventes » lit de la main du cabinet : chaque libellé le dit', () => {
  const LIBELLES: [string, string, string][] = [
    [LIBELLE_NOTES_FACTURE, 'elles ne figurent pas sur la facture', 'les lit'],
    [LIBELLE_MOTIF_AVOIR, 'il ne figure pas sur l’avoir', 'le lit'],
    [LIBELLE_MOTIF_CONTRE_PASSATION, 'que la plateforme portera', 'que lit le client'],
    [LIBELLE_NOTE_DECLARATION, 'qui l’a saisi, quand, sous quelle référence', 'la lit'],
    // Les deux textes libres d'un article (étape A2a) : la table `articles` est ouverte à « Ventes » par sa migration (le test
    // plus bas confronte sa policy à l'export).
    [LIBELLE_DESIGNATION_ARTICLE, 'le nom de l’article', 'la lit'],
    [LIBELLE_DESCRIPTION_ARTICLE, 'facultative', 'la lit'],
    // Les trois textes libres d'un contact (étape A4b1) : la table `contacts` est ouverte à « Ventes » par sa migration (le test
    // plus bas confronte sa policy et ses colonnes à l'export).
    [LIBELLE_NOM_CONTACT, 'Nom ou raison sociale', 'le lit'],
    [LIBELLE_ADRESSE_CONTACT, 'Adresse', 'la lit'],
    [LIBELLE_OBSERVATIONS_CONTACT, 'facultatives', 'les lit'],
  ]

  it('aucun ne se dit interne ; chacun dit où le texte va, et que le client qui porte la case le lit', () => {
    for (const [libelle, ou, lit] of LIBELLES) {
      expect(libelle).not.toMatch(/intern/i)
      expect(libelle).toContain(`le client qui porte la case « ${definitionDe('ventes').libelle} »`)
      expect(libelle).toContain(ou)
      expect(libelle).toContain(lit)
    }
    expect(new Set(LIBELLES.map(([l]) => l)).size).toBe(9)
  })

  it('la phrase des cases dit lus les textes que les libellés disent lus', () => {
    for (const banque of [false, true]) {
      for (const articles of [false, true]) {
        expect(ceQueDisentLesCases(banque, true, articles, false, false, false)).toContain('avec ce que le cabinet y a écrit (notes et motifs)')
      }
    }
  })

  // Chaque texte vit dans une table que la migration des ventes ouvre en lecture : le jour où l'export la porte, la
  // policy de chaque table est là (sinon le libellé dirait lu ce que le client ne lit pas).
  it('chaque texte vit dans une table que l’export ouvre à « Ventes », dès qu’il porte la migration', () => {
    const tables = ['factures_emises', 'encaissements_factures', 'transmissions_encaissements']
    for (const table of tables) expect(Object.values(LU_AVEC_VENTES).flat()).toContain(table)
    if (!VENTES_DU_CLIENT_EXPORTEES) return
    for (const table of tables) {
      expect(fichiersDuSchema().some((f) => f.texte.includes(`create policy ${table}_lecture_ventes on public.${table}`)), table).toBe(true)
    }
  })

  // La désignation et la description d'un article (étape A2a) vivent dans `articles`, que le droit « Ventes » ouvre en lecture
  // dès l'export de sa migration : sans cela, leurs libellés diraient lu ce que le client ne lit pas.
  it('la désignation et la description d’un article vivent dans une table que l’export ouvre à « Ventes »', () => {
    if (!ARTICLES_EXPORTES) return
    expect(fichiersDuSchema().some((f) => f.texte.includes('create policy articles_lecture_ventes on public.articles'))).toBe(true)
    expect(fichiersDuSchema().some((f) => /create table public\.articles \([^;]*\bdesignation text\b[^;]*\bdescription text\b/.test(f.texte))).toBe(true)
  })

  // Le nom, l'adresse et les observations d'un contact (étape A4b1) vivent dans `contacts`, que « Ventes » lit dès l'export de sa
  // migration, colonnes comprises : sans cela, leurs libellés diraient lu ce que le client ne lit pas.
  it('le nom, l’adresse et les observations d’un contact vivent dans une table que l’export ouvre à « Ventes »', () => {
    if (!CONTACTS_EXPORTES) return
    expect(fichiersDuSchema().some((f) => f.texte.includes('create policy contacts_lecture_ventes on public.contacts'))).toBe(true)
    expect(fichiersDuSchema().some((f) => /create table public\.contacts \([^;]*\bnom text\b[^;]*\badresse text\b[^;]*\bobservations text\b/.test(f.texte))).toBe(true)
  })
})

// CE QUE LE CLIENT « BANQUE » LIT DE LA MAIN DU CABINET (espace client, étape P9b) : la question que le cabinet écrit sur un
// mouvement (« Demander au client », FicheMouvement) vit dans le fil, que la migration `banque_du_client` ouvre au client qui
// porte la case — et son libellé le dit, comme ceux des ventes.
describe('ce que le client « Banque » lit de la main du cabinet : la question le dit', () => {
  it('le libellé de la question nomme le client qui porte la case « Banque », et qu’il la lit', () => {
    expect(LIBELLE_QUESTION_MOUVEMENT).not.toMatch(/intern/i)
    expect(LIBELLE_QUESTION_MOUVEMENT).toContain(`le client qui porte la case « ${definitionDe('banque').libelle} » la lit`)
  })

  it('le fil vit dans une table que l’export ouvre à « Banque », et ne s’écrit que par sa fonction', () => {
    const fichiers = fichiersDuSchema()
    expect(fichiers.some((f) => /create policy precisions_mouvements_lecture on public\.precisions_mouvements\s+for select to authenticated using \(gere_la_banque\(dossier_id\)\);/.test(f.texte)))
      .toBe(true)
    expect(derniereDefinitionSql('ecrire_precision_mouvement')).toContain('if not public.gere_la_banque(p_dossier_id)')
  })
})
