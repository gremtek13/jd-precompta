import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AUCUN_DROIT, CE_QUE_DONNE_UN_ACCES, DOMAINES, LIBELLE_MOTIF_AVOIR, LIBELLE_MOTIF_CONTRE_PASSATION,
  LIBELLE_ESCOMPTE_PARAMETRES, LIBELLE_ESCOMPTE_PARAMETRES_CLIENT, LIBELLE_MENTIONS_PARAMETRES, LIBELLE_MENTIONS_PARAMETRES_CLIENT,
  LIBELLE_PENALITES_PARAMETRES, LIBELLE_PENALITES_PARAMETRES_CLIENT, LIBELLE_PIED_DE_PAGE_PARAMETRES, LIBELLE_PIED_DE_PAGE_PARAMETRES_CLIENT,
  LIBELLE_TITULAIRE_PARAMETRES, LIBELLE_TITULAIRE_PARAMETRES_CLIENT,
  LIBELLE_ADRESSE_IDENTITE, LIBELLE_DENOMINATION_IDENTITE, LIBELLE_RCS_VILLE_IDENTITE,
  LIBELLE_ADRESSE_CONTACT, LIBELLE_DESCRIPTION_ARTICLE, LIBELLE_DESIGNATION_ARTICLE, LIBELLE_NOM_CONTACT, LIBELLE_NOTE_DECLARATION, LIBELLE_OBSERVATIONS_CONTACT, LIBELLE_NOTES_DEVIS, LIBELLE_NOTES_FACTURE, LIBELLE_QUESTION_MOUVEMENT, ceQueDisentLesCases, ceQueDisentLesCasesDuDossier, ceQueDonneUnAcces, changementApplique, definitionDe,
  demandeDeChangement, droitsDeLaLigne, droitsParDossier, droitsSur, libelleDeLaCase, messageDuRefus, type ReglageDuDossier,
  type EtatCaisseDuDossier, CE_QUE_LA_CASE_CAISSE_OUVRE, CE_QUE_LA_CASE_RETIENT, CE_QUE_MONTRE_MA_CAISSE, REFUS_CAISSE_DOSSIER_NON_EXCLU,
  REFUS_STATUT_SOUS_LA_CASE_CAISSE, TABLES_LUES_AVEC_CAISSE, ceQueDitLaCaseCaisse, confirmationDeLaCaseCaisse, enumeration,
  etatCaisseDuDossier, libellesDesCases, phraseDuStatutDeLaCaisse, raisonDuDossierNonExclu, raisonDuStatutIllisible,
  RAISON_DU_DOSSIER_EN_ENGAGEMENT, raisonDuModeIllisible, avisDuStatutSousLaCase,
  CE_QUE_COMPTENT_SES_FACTURES, PHRASE_DES_VENTES_DE_LA_SIMULATION, gesteDeLaCase, phraseDuReglage, raisonDuDossierNonBascule,
  raisonDuReglageIllisible, refusDeLaCase, reglageDuDossier, REFUS_VENTES_DOSSIER_NON_BASCULE, ceQueMontreMaCaisseSelon,
  CE_QUE_LA_CASE_COMPTES_OUVRE, TABLES_LUES_AVEC_COMPTES, ceQueDitLaCaseComptes, demandeDeChangementSelon, domainesSelon,
} from './droitsAcces'
import { SITUATIONS_PUBLIEES_EXPORTEES } from './situationsPubliees'
import { CORRECTION_DU_PAIEMENT_EXPORTEE } from './correctionDuPaiement'
import { BASCULE_OFFERTE } from './basculeDesVentes'
import { ADRESSES_RECEPTION_EXPORTEES } from './adressesReception'
import { ARTICLES_EXPORTES } from './articles'
import { CHANGEMENT_DE_RIB_EXPORTE, DUREE_DE_L_AVIS_EN_JOURS } from './changementDeRib'
import { CONTACTS_EXPORTES } from './contacts'
import { IMPORT_CONTACTS_EXPORTE, LIGNES_PAR_IMPORT_MAX } from './contactsImport'
import { COUVERTURE_EXPORTEE } from './couvertureReleve'
import { DEVIS_EXPORTES, ENVOI_DES_DEVIS_PREVU } from './devis'
import { RELANCES_EXPORTEES } from './relances'
import { motsDuCabinet } from './espaceVentes'
import { VENTES_DU_CLIENT_EXPORTEES } from './encaissementsFactures'
import { LOGO_DES_FACTURES_EXPORTE } from './logoDesFactures'
import { PARAMETRES_FACTURATION_EXPORTES } from './parametresFacturation'
import { SIMULATION_VENTES_FACTUREES_EXPORTEE } from './simulationVentesFacturees'
import { contact } from '../test/contacts'
import { versionParametres } from '../test/parametresFacturation'
import { QUI_PEUT_QUOI_ATTENDU } from '../test/quiPeutQuoi'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { codesSql, messagesSql } from '../test/raiseSql'
import { MOTS_DE_LA_CAISSE, STATUTS_DE_LA_SAISIE_DU_CLIENT } from './caisse'

// LES DROITS D'UN ACCÈS CLIENT (espace client, étape P1). Ce qui se garde ici : qu'un droit ne s'accorde jamais par défaut,
// qu'une case cliquée n'envoie que SON droit, et que le module, la migration et les écrans du client disent la même chose.
// Les phrases des drapeaux se jouent sur un dossier basculé : son réglage ajoute la même phrase à chaque état (étape VF8d,
// plus bas, joue les trois réglages).
const BASCULE: ReglageDuDossier = { etat: 'bascule' }
// Les cases « Ventes » et « Banque » se jouent sur un dossier exonéré : la case « Caisse » y a ses deux gestes (étape C11, plus
// bas, joue les trois états du statut de TVA).
const EXONERE: EtatCaisseDuDossier = { etat: 'exclu', statut: 'exonere' }

// LE DRAPEAU DE LA BASCULE (étape VF8b, lib/basculeDesVentes.ts), joué dans ses deux états : la phrase de l'onglet Accès suit
// le GESTE que la carte « Source des ventes » offre, pas son existence. Nul, le drapeau est celui du module.
const drapeau = vi.hoisted(() => ({ offerte: null as boolean | null, simulation: null as boolean | null, devis: null as boolean | null }))
vi.mock('./basculeDesVentes', async (original) => {
  const vrai = await original<typeof import('./basculeDesVentes')>()
  return { ...vrai, get BASCULE_OFFERTE() { return drapeau.offerte ?? vrai.BASCULE_OFFERTE } }
})
// LE DRAPEAU DES VENTES FACTURÉES DE LA SIMULATION (étape VF8e, lib/simulationVentesFacturees.ts), joué de même dans ses deux
// états : faux tant que sa migration, préparée, n'est pas appliquée. Nul, le drapeau est celui du module.
vi.mock('./simulationVentesFacturees', async (original) => {
  const vrai = await original<typeof import('./simulationVentesFacturees')>()
  return { ...vrai, get SIMULATION_VENTES_FACTUREES_EXPORTEE() { return drapeau.simulation ?? vrai.SIMULATION_VENTES_FACTUREES_EXPORTEE } }
})
// LE DRAPEAU DES DEVIS (étape P5, lib/devis.ts), joué de même dans ses deux états : faux tant que leurs deux migrations,
// préparées, ne sont pas appliquées. Nul, le drapeau est celui du module — celui que l'export confronte.
vi.mock('./devis', async (original) => {
  const vrai = await original<typeof import('./devis')>()
  return { ...vrai, get DEVIS_EXPORTES() { return drapeau.devis ?? vrai.DEVIS_EXPORTES } }
})

const MIGRATION = readFileSync(resolve(process.cwd(), 'supabase/schema/20261009224031_droits_des_acces_clients.sql'), 'utf8')
// La migration de la case « Caisse » (ligne 26.6, étape C10, en base et dans l'export depuis le 02/11/2026) : la colonne, la
// forme à quatre de `changer_droits_acces`, et les gardes que l'onglet Accès redit (étape C11).
const CAISSE_DU_CLIENT = fichiersDuSchema().find((f) => /\/\d{14}_caisse_du_client\.sql$/.test(f.chemin))?.texte ?? ''

describe('les droits d’une ligne : seul « vrai » accorde', () => {
  it('lit les trois colonnes', () => {
    expect(droitsDeLaLigne({ droit_ventes: true, droit_banque: false, droit_caisse: false })).toEqual({ ventes: true, banque: false, caisse: false, comptes: false })
    expect(droitsDeLaLigne({ droit_ventes: false, droit_banque: true, droit_caisse: false })).toEqual({ ventes: false, banque: true, caisse: false, comptes: false })
    expect(droitsDeLaLigne({ droit_ventes: false, droit_banque: false, droit_caisse: true })).toEqual({ ventes: false, banque: false, caisse: true, comptes: false })
  })

  it('une colonne absente, nulle ou d’un autre type ne donne rien — une ligne d’avant la migration non plus', () => {
    const rien = { ventes: false, banque: false, caisse: false, comptes: false }
    for (const valeur of [undefined, null, 'true', 1, 'oui', {}]) {
      expect(droitsDeLaLigne({ droit_ventes: valeur, droit_banque: valeur, droit_caisse: valeur }), String(valeur)).toEqual(rien)
    }
    // Une ligne d'avant la migration `caisse_du_client` : ses deux droits, et pas de « Caisse ».
    expect(droitsDeLaLigne({ droit_ventes: true, droit_banque: true })).toEqual({ ventes: true, banque: true, caisse: false, comptes: false })
    expect(droitsDeLaLigne({})).toEqual(rien)
    expect(droitsDeLaLigne(null)).toEqual(rien)
    expect(droitsDeLaLigne(undefined)).toEqual(rien)
  })
})

describe('les droits par dossier', () => {
  it('chaque accès donne les droits de SON dossier, et rien aux autres', () => {
    const droits = droitsParDossier([
      { dossier_id: 'd1', droit_ventes: true, droit_banque: false, droit_caisse: false },
      { dossier_id: 'd2', droit_ventes: false, droit_banque: true, droit_caisse: true },
      { dossier_id: 'd3' },
    ])
    expect(droits).toEqual({
      d1: { ventes: true, banque: false, caisse: false, comptes: false },
      d2: { ventes: false, banque: true, caisse: true, comptes: false },
      d3: { ventes: false, banque: false, caisse: false, comptes: false },
    })
    expect(droitsSur(droits, 'd1')).toEqual({ ventes: true, banque: false, caisse: false, comptes: false })
    expect(droitsSur(droits, 'd2').caisse).toBe(true)
    expect(droitsSur(droits, 'd9')).toEqual(AUCUN_DROIT)
    expect(droitsSur(droits, null)).toEqual(AUCUN_DROIT)
    expect(droitsSur(droits, undefined)).toEqual(AUCUN_DROIT)
    expect(droitsSur(droits, '')).toEqual(AUCUN_DROIT)
  })

  it('deux lignes d’un même dossier (la base l’interdit) n’additionnent pas leurs droits : chacun doit être sur les deux', () => {
    expect(droitsParDossier([
      { dossier_id: 'd1', droit_ventes: true, droit_banque: true, droit_caisse: true },
      { dossier_id: 'd1', droit_ventes: false, droit_banque: true, droit_caisse: false },
    ])).toEqual({ d1: { ventes: false, banque: true, caisse: false, comptes: false } })
    expect(droitsParDossier([
      { dossier_id: 'd1', droit_ventes: false, droit_banque: false, droit_caisse: false },
      { dossier_id: 'd1', droit_ventes: true, droit_banque: true, droit_caisse: true },
    ])).toEqual({ d1: { ventes: false, banque: false, caisse: false, comptes: false } })
    expect(droitsParDossier([
      { dossier_id: 'd1', droit_caisse: true },
      { dossier_id: 'd1', droit_caisse: true },
    ])).toEqual({ d1: { ventes: false, banque: false, caisse: true, comptes: false } })
  })

  it('aucun accès, aucun droit', () => {
    expect(droitsParDossier([])).toEqual({})
  })

  it('les droits rendus pour un dossier inconnu sont une copie : les modifier ne touche pas l’absence de droit commune', () => {
    const rendus = droitsSur({}, 'd1')
    rendus.ventes = true
    rendus.caisse = true
    expect(AUCUN_DROIT).toEqual({ ventes: false, banque: false, caisse: false, comptes: false })
    expect(droitsSur({}, 'd1')).toEqual({ ventes: false, banque: false, caisse: false, comptes: false })
  })
})

describe('une case cliquée n’envoie que son droit', () => {
  it('les autres droits partent nuls, donc inchangés en base ; le droit cliqué part seul — jamais trois nuls', () => {
    expect(demandeDeChangement('m1', 'ventes', true)).toEqual({ p_membership_id: 'm1', p_ventes: true, p_banque: null, p_caisse: null })
    expect(demandeDeChangement('m1', 'ventes', false)).toEqual({ p_membership_id: 'm1', p_ventes: false, p_banque: null, p_caisse: null })
    expect(demandeDeChangement('m2', 'banque', true)).toEqual({ p_membership_id: 'm2', p_ventes: null, p_banque: true, p_caisse: null })
    expect(demandeDeChangement('m2', 'banque', false)).toEqual({ p_membership_id: 'm2', p_ventes: null, p_banque: false, p_caisse: null })
    expect(demandeDeChangement('m3', 'caisse', true)).toEqual({ p_membership_id: 'm3', p_ventes: null, p_banque: null, p_caisse: true })
    expect(demandeDeChangement('m3', 'caisse', false)).toEqual({ p_membership_id: 'm3', p_ventes: null, p_banque: null, p_caisse: false })
    for (const { domaine } of DOMAINES) {
      for (const valeur of [true, false]) {
        const { p_membership_id: _id, ...droits } = demandeDeChangement('m', domaine, valeur)
        expect(Object.values(droits).filter((v) => v !== null), `${domaine} ${valeur}`).toEqual([valeur])
      }
    }
  })

  it('la demande part à la forme à QUATRE : ses noms sont ceux de la dernière forme en base, dans son ordre, et elle seule écrit', () => {
    // La forme à quatre de la migration `caisse_du_client` : `create function`, et non `create or replace` (elle est neuve).
    const signature = /create function public\.changer_droits_acces\(([^)]*)\)/.exec(CAISSE_DU_CLIENT)
    expect(signature, 'la forme à quatre introuvable dans l’export').not.toBeNull()
    const parametres = signature![1].split(',').map((p) => p.trim().split(/\s+/)[0])
    expect(parametres).toEqual(Object.keys(demandeDeChangement('m', 'ventes', true)))
    expect(parametres).toEqual(['p_membership_id', 'p_ventes', 'p_banque', 'p_caisse'])
    // La forme à quatre est la dernière définition du nom (celle que relit `derniereDefinitionSql`), et elle écrit les trois
    // colonnes, un droit nul inchangé ; la forme à trois ne fait que l'appeler, « Caisse » nul.
    const derniere = derniereDefinitionSql('changer_droits_acces')
    expect(derniere).toContain('p_caisse boolean')
    expect(derniere).toContain('droit_caisse = coalesce(p_caisse, m.droit_caisse)')
    expect(derniere).toContain("if p_ventes is null and p_banque is null and p_caisse is null then")
    const trois = /create or replace function public\.changer_droits_acces\(p_membership_id uuid, p_ventes boolean, p_banque boolean\)[\s\S]*?\$\$([\s\S]*?)\$\$;/
      .exec(CAISSE_DU_CLIENT)?.[1] ?? ''
    expect(trois.trim()).toBe('begin\n  return public.changer_droits_acces(p_membership_id, p_ventes, p_banque, null::boolean);\nend;')
    expect(CAISSE_DU_CLIENT).toContain('grant execute on function public.changer_droits_acces(uuid, boolean, boolean, boolean) to authenticated;')
  })

  it('reconnaît l’accès rendu qui porte le droit demandé, et seulement lui', () => {
    expect(changementApplique({ id: 'm1', droit_ventes: true, droit_banque: false }, 'ventes', true)).toBe(true)
    expect(changementApplique({ id: 'm1', droit_ventes: true, droit_banque: false }, 'banque', false)).toBe(true)
    expect(changementApplique({ id: 'm1', droit_ventes: false, droit_banque: false }, 'ventes', true)).toBe(false)
    expect(changementApplique({ id: 'm1', droit_ventes: 'true' }, 'ventes', true)).toBe(false)
    expect(changementApplique({ id: 'm1' }, 'banque', false)).toBe(false)
    expect(changementApplique({ id: 'm1', droit_caisse: true }, 'caisse', true)).toBe(true)
    expect(changementApplique({ id: 'm1', droit_caisse: false, droit_ventes: true }, 'caisse', true)).toBe(false)
    expect(changementApplique({ id: 'm1', droit_ventes: true }, 'caisse', false)).toBe(false)
    for (const rendu of [null, undefined, 'ok', true, 1]) expect(changementApplique(rendu, 'ventes', true), String(rendu)).toBe(false)
  })
})

describe('le module, la migration et les écrans disent la même chose', () => {
  it('chaque domaine a sa colonne en base : booléenne, non nulle, fausse par défaut', () => {
    const export_ = fichiersDuSchema().map((f) => f.texte).join('\n')
    for (const { colonne } of DOMAINES) {
      // Les deux premières dans le même `alter table` (droits_des_acces_clients), la troisième seule (caisse_du_client).
      expect(export_, colonne).toMatch(new RegExp(`alter table public\\.memberships\\s+(add column \\w+ boolean not null default false,\\s+)?add column ${colonne} boolean not null default false[,;]`))
    }
    expect(DOMAINES.map((d) => d.domaine)).toEqual(['ventes', 'banque', 'caisse'])
    expect(() => definitionDe('achats' as never)).toThrow('Domaine inconnu')
  })

  it('ce que l’écran dit d’un droit est ce que dit le commentaire de sa colonne en base — le dernier que l’export pose', () => {
    for (const { colonne, libelle, ouvrira } of DOMAINES) {
      // Le dernier commentaire, fichiers dans l'ordre de leur nom puis texte dans l'ordre : celui de la colonne en base. Une
      // apostrophe s'y double (`''`) ; l'étape VF8f réécrit celui de `droit_ventes`.
      const motif = new RegExp(`comment on column public\\.memberships\\.${colonne} is\\s+'((?:[^']|'')*)'`, 'g')
      const commentaires = fichiersDuSchema().flatMap((f) => [...f.texte.matchAll(motif)].map((m) => m[1].replace(/''/g, "'")))
      expect(commentaires.length, colonne).toBeGreaterThanOrEqual(1)
      expect(commentaires.at(-1), colonne).toContain(`Le droit « ${libelle} » de cet accès (${ouvrira})`)
    }
  })

  it('les mots que client_du_dossier connaît sont les domaines du module, et « membre » — dans sa dernière définition', () => {
    const corps = derniereDefinitionSql('client_du_dossier')
    const mots = [...corps.matchAll(/when '(\w+)' then/g)].map((m) => m[1])
    expect(mots.sort()).toEqual([...DOMAINES.map((d) => d.domaine), 'membre'].sort())
    for (const { domaine, colonne } of DOMAINES) expect(corps, domaine).toContain(`when '${domaine}' then m.${colonne}`)
    expect(corps).toMatch(/else false/)
    // Et la première définition, d'hier, ne connaissait que les deux premiers.
    const hier = /create function public\.client_du_dossier[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(MIGRATION)?.[1] ?? ''
    expect([...hier.matchAll(/when '(\w+)' then/g)].map((m) => m[1]).sort()).toEqual(['banque', 'membre', 'ventes'])
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
      '/mon-echeancier ClientEcheancier', '/mes-ventes ClientVentes', '/ma-banque ClientBanque', '/ma-caisse ClientCaisse',
      '/mes-comptes ClientComptes', '/mon-analyse ClientAnalyse',
    ])
    // DEPUIS L'ÉTAPE C4b, « Mes comptes » lit la case « Comptes », derrière `SITUATIONS_PUBLIEES_EXPORTEES`
    // (lib/situationsPubliees.ts, `mesComptesOuverts`), sa route et son entrée ; l'écran relit sa case à la base.
    expect(app).toContain('mesComptesOuverts(SITUATIONS_PUBLIEES_EXPORTEES, droitsSur(droitsParDossier ?? {}, dossierActifId).comptes)')
    const ecransClient = readdirSync(resolve(process.cwd(), 'src/pages')).filter((f) => /^Client\w+\.tsx$/.test(f) && !f.includes('.test.'))
    expect(ecransClient.sort()).toEqual([
      'ClientAnalyse.tsx', 'ClientBanque.tsx', 'ClientCaisse.tsx', 'ClientComptes.tsx', 'ClientEcheancier.tsx', 'ClientHome.tsx',
      'ClientInformations.tsx',
      'ClientSimulation.tsx', 'ClientUpload.tsx', 'ClientVentes.tsx',
    ])
    // DEPUIS L'ÉTAPE C1, « Mon échéancier » et sa carte de l'accueil lisent la case « Banque » de la société affichée pour les
    // MONTANTS seulement (une règle d'écran, comme « Ma simulation ») : la route est ouverte à tout accès, et rien d'autre.
    expect(app).toContain('<Route path="/mon-echeancier" element={<ClientEcheancier />} />')
    for (const fichier of ['ClientEcheancier.tsx', 'EcheancierAccueil.tsx']) {
      const texte = readFileSync(resolve(process.cwd(), `src/pages/${fichier}`), 'utf8')
      expect(texte, fichier).toMatch(/const avecMontants = droitsSur\(droitsParDossier \?\? \{\}, (dossierActifId|dossierId)\)\.banque === true/)
      expect(texte, fichier).not.toMatch(/droit_ventes|droit_banque|droit_caisse|\.ventes\b|\.caisse\b/)
      expect(texte.match(/droitsSur\(/g), fichier).toHaveLength(1)
    }
    // DEPUIS L'ÉTAPE P4b, l'accueil lit la case « Ventes » pour ses tuiles « À encaisser » et « À déclarer » : la même garde
    // que la route, sur la société affichée, et rien d'autre ; les tuiles relisent leurs cases à la base.
    const accueil = readFileSync(resolve(process.cwd(), 'src/pages/ClientHome.tsx'), 'utf8')
    expect(accueil).toContain('mesVentesOuvertes(VENTES_DU_CLIENT_EXPORTEES, droitsSur(droitsParDossier ?? {}, dossierId).ventes)')
    // Et, depuis l'étape P9, la tuile « Ma banque » : la case « Banque » sous la garde de sa route, et rien d'autre.
    expect(accueil).toContain('maBanqueOuverte(COUVERTURE_EXPORTEE, droitsSur(droitsParDossier ?? {}, dossierId).banque)')
    // Et, depuis l'étape C12a, la tuile « Ma caisse » : la case « Caisse » sous la garde de sa route, et rien d'autre.
    expect(accueil).toContain('maCaisseOuverte(CAISSE_DU_CLIENT_EXPORTEE, droitsSur(droitsParDossier ?? {}, dossierId).caisse)')
    expect(accueil).not.toMatch(/droit_ventes|droit_banque|droit_caisse/)
    expect(accueil.match(/\.banque\b/g)).toHaveLength(1)
    expect(accueil.match(/\.caisse\b/g)).toHaveLength(1)
    expect(accueil.match(/droitsSur\(/g)).toHaveLength(3)
    // DEPUIS L'ÉTAPE A6b2, les cases se relisent à la base dans UNE lecture des ventes (`useVentesDuClient`), partagée par les tuiles
    // et l'encart « Facture électronique » : les tuiles ne lisent plus rien, l'encart ne lit que l'état de sa facture électronique.
    const lectureDesVentes = readFileSync(resolve(process.cwd(), 'src/lib/ventesDuClientLecture.ts'), 'utf8')
    expect(lectureDesVentes).toContain("supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId })")
    expect(lectureDesVentes).not.toMatch(/droit_ventes|droit_banque|droitsParDossier|droitsSur\b/)
    for (const fichier of ['TuilesVentesClient.tsx', 'AccueilVentesClient.tsx']) {
      const texte = readFileSync(resolve(process.cwd(), `src/pages/${fichier}`), 'utf8')
      expect(texte, fichier).not.toMatch(/droit_ventes|droit_banque|droitsParDossier|droitsSur\b|supabase/)
    }
    for (const fichier of ['ClientInformations.tsx'].map((f) => `src/pages/${f}`)) {
      const texte = readFileSync(resolve(process.cwd(), fichier), 'utf8')
      expect(texte, fichier).not.toMatch(/droit_ventes|droit_banque|droitsParDossier|droitsSur\b|droitsAcces/)
    }
    // DEPUIS L'ÉTAPE C12b, « Mes pièces » lit la case « Caisse » sous la garde de la route de « Ma caisse », pour le paiement
    // d'une pièce par la caisse, et rien d'autre ; la lecture de la caisse la relit à la base (lib/caisseClientLecture.ts).
    const mesPieces = readFileSync(resolve(process.cwd(), 'src/pages/ClientUpload.tsx'), 'utf8')
    expect(mesPieces).toContain('maCaisseOuverte(CAISSE_DU_CLIENT_EXPORTEE, droitsSur(droitsParDossier ?? {}, dossierId).caisse)')
    expect(mesPieces).not.toMatch(/droit_ventes|droit_banque|droit_caisse|\.ventes\b|\.banque\b/)
    expect(mesPieces.match(/droitsSur\(/g)).toHaveLength(1)
    expect(mesPieces).toContain('lireLaCaisseDuClient(')
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
    // « Ma caisse » (étape C12a) : la route et l'entrée lisent la case « Caisse » de la société AFFICHÉE, derrière le drapeau,
    // et rien d'autre ; l'écran relit sa case à la base, par sa lecture, et ne lit pas celles d'AuthContext.
    const gardeCaisse = 'maCaisseOuverte(CAISSE_DU_CLIENT_EXPORTEE, droitsSur(droitsParDossier ?? {}, dossierActifId).caisse)'
    expect(app).toContain(`{${gardeCaisse} && <Route path="/ma-caisse" element={<ClientCaisse />} />}`)
    expect(layout).toContain(gardeCaisse)
    expect(layout.match(/\.caisse\b/g)).toHaveLength(1)
    expect(layout).not.toMatch(/droit_caisse/)
    const caisse = readFileSync(resolve(process.cwd(), 'src/pages/ClientCaisse.tsx'), 'utf8')
    expect(caisse).not.toMatch(/droit_ventes|droit_banque|droit_caisse|droitsParDossier|droitsSur\b/)
    const lectureDeLaCaisse = readFileSync(resolve(process.cwd(), 'src/lib/caisseClientLecture.ts'), 'utf8')
    expect(lectureDeLaCaisse).toContain("supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId })")
    // « Mon analyse » (étape B9a) : aucune case à elle — la route et l'entrée sous la garde de « Mes ventes » OU de « Ma
    // banque », et rien d'autre ; l'écran demande ce que ces deux gardes ouvrent, et sa lecture relit les cases à la base.
    expect(app).toContain(`{monAnalyseOuverte(${gardeVentes}, ${gardeBanque}) && <Route path="/mon-analyse" element={<ClientAnalyse />} />}`)
    expect(layout).toContain('{monAnalyseOuverte(mesVentes, maBanque) && (')
    const analyse = readFileSync(resolve(process.cwd(), 'src/pages/ClientAnalyse.tsx'), 'utf8')
    expect(analyse).toContain('mesVentesOuvertes(VENTES_DU_CLIENT_EXPORTEES, cases.ventes)')
    expect(analyse).toContain('maBanqueOuverte(COUVERTURE_EXPORTEE, cases.banque)')
    // « Ce qui a bougé » (étape B9c) : la case « Caisse » n'ouvre pas la page, elle n'ouvre que les évènements de la caisse,
    // derrière son drapeau, et la lecture la relit à la base comme les deux autres.
    expect(analyse).toContain('maCaisseOuverte(CAISSE_DU_CLIENT_EXPORTEE, cases.caisse)')
    expect(analyse.match(/\.caisse\b/g)).toHaveLength(1)
    expect(analyse).not.toMatch(/droit_ventes|droit_banque|droit_caisse|supabase/)
    const lectureDeLAnalyse = readFileSync(resolve(process.cwd(), 'src/lib/analyseClientLecture.ts'), 'utf8')
    expect(lectureDeLAnalyse).toContain("supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId })")
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

// Ce que « Ventes » ouvre de ses devis (étape P5), le jour où l'export porte leurs deux migrations : la lecture de deux
// tables (une policy `…_lecture_ventes` chacune), et quatre gestes par des fonctions sous `gere_les_ventes`.
const LU_AVEC_DEVIS: Record<string, readonly string[]> = {
  'ses devis et le lien de chacun à la facture qui en est tirée': ['devis', 'devis_factures'],
}
const GESTES_AVEC_DEVIS: Record<string, readonly string[]> = {
  'créer, modifier ou émettre un devis': ['enregistrer_devis'],
  'l’accepter ou le refuser': ['decider_devis'],
  'en tirer un brouillon de facture': ['facturer_devis'],
  'supprimer un brouillon de devis': ['supprimer_brouillon_devis'],
}
// Ce que « Ventes » ouvre en LECTURE, tel que la phrase le nomme, et les tables que la migration ventes_du_client ouvre
// pour le dire (une policy `…_lecture_ventes` chacune) — les devis compris, drapeau levé (celui du module, que l'export
// confronte).
const LU_AVEC_VENTES: Record<string, readonly string[]> = {
  ...(DEVIS_EXPORTES ? LU_AVEC_DEVIS : {}),
  'ses factures et avoirs': ['factures_emises', 'facture_lignes'],
  'leurs transmissions et leur suivi': ['transmissions_factures', 'facture_superpdp_events'],
  'les statuts lus sur sa plateforme': ['statuts_factures_recus'],
  'ses encaissements et leurs déclarations': ['encaissements_factures', 'encaissements_factures_taux', 'transmissions_encaissements'],
  'les e-mails qui les ont envoyés': ['emails_envoyes'],
}
// Ses GESTES, et les fonctions qui les font : chacune accepte, depuis les ventes du client, `gere_les_ventes`.
const GESTES_AVEC_VENTES: Record<string, readonly string[]> = {
  ...(DEVIS_EXPORTES ? GESTES_AVEC_DEVIS : {}),
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
  // L'envoi d'un devis émis (étape P6c) : la phrase des devis le nomme, sa migration en base.
  ...(DEVIS_EXPORTES && ENVOI_DES_DEVIS_PREVU
    ? { 'envoyer un devis émis par e-mail, dans le même plafond que ses factures': [['send-email', 'devis']] as const }
    : {}),
  // La relance d'une facture en retard (étape C5) : la phrase la nomme sous son drapeau.
  ...(RELANCES_EXPORTEES
    ? { 'relancer par e-mail une facture en retard, dans le même plafond': [['send-email', 'relance_facture']] as const }
    : {}),
}
// LES ACTIONS QUE LA TABLE OUVRE À « VENTES » ET QUE LA PHRASE NE NOMME PAS ENCORE, chacune avec sa raison — une liste au
// nombre près. L'envoi d'un devis par e-mail (`send-email › devis`, étape P6c2) : la fonction le sait, mais elle ne se
// déploie qu'après la migration préparée `envoi_des_devis` (le journal refuse jusque-là une ligne « devis ») ; la phrase
// ne dit pas ce que le client ne peut pas encore faire. Le jour où l'export porte la migration (`ENVOI_DES_DEVIS_PREVU`
// levé), la liste se vide, et la confrontation ci-dessous exige que la phrase nomme l'envoi d'un devis.
// La relance d'une facture en retard (`send-email › relance_facture`, étape C5) de même : la fonction la sait, sous une
// constante baissée jusqu'à la migration préparée `relances_des_factures` ; la phrase la nomme le jour où
// `RELANCES_EXPORTEES` se lève.
const PAS_ENCORE_NOMMEES: readonly (readonly [FonctionDeLaVente, string])[] = [
  ...(ENVOI_DES_DEVIS_PREVU ? [] : [['send-email', 'devis'] as const]),
  ...(RELANCES_EXPORTEES ? [] : [['send-email', 'relance_facture'] as const]),
]

describe('ce que disent les cases, dans les quatre états des deux étapes', () => {
  const PREFIXE = '« Ventes » (devis, factures, facture électronique) et « Banque » (comptes, mouvements, connexion bancaire) : '
  const ETATS = [
    { banque: false, ventes: false },
    { banque: true, ventes: false },
    { banque: false, ventes: true },
    { banque: true, ventes: true },
  ]

  it.each(ETATS)('banque ouverte : $banque, ventes ouvertes : $ventes — ce que la base ouvre, et rien d’autre', ({ banque, ventes }) => {
    const phrase = ceQueDisentLesCases(banque, ventes, false, false, false, false, false, false, false, BASCULE, false, DEVIS_EXPORTES)
    expect(phrase.startsWith(PREFIXE)).toBe(true)
    const suite = phrase.slice(PREFIXE.length)
    // Drapeau baissé, les devis n'existent pas encore (étape P5) : seul le préfixe, qui dit ce que la case OUVRIRA, les
    // nomme. Levé, la phrase des ventes les nomme (LU_AVEC_VENTES et GESTES_AVEC_VENTES les portent alors).
    if (!DEVIS_EXPORTES || !ventes) expect(suite).not.toMatch(/devis/)
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
    expect(new Set(ETATS.map(({ banque, ventes }) => ceQueDisentLesCases(banque, ventes, false, false, false, false, false, false, false, BASCULE, false, false))).size).toBe(4)
  })

  // Le drapeau des devis, forcé dans ses deux états : l'onglet suit celui que lit le module.
  it.each([false, true])('ce que l’onglet affiche est la phrase de l’état des drapeaux et du réglage lu — devis exportés : %s', (devis) => {
    drapeau.devis = devis
    try {
      for (const reglage of [BASCULE, { etat: 'non_bascule' }, { etat: 'illisible', motif: 'lecture refusée' }] as const) {
        expect(ceQueDisentLesCasesDuDossier(reglage)).toBe(ceQueDisentLesCases(
          COUVERTURE_EXPORTEE, VENTES_DU_CLIENT_EXPORTEES, ARTICLES_EXPORTES, ADRESSES_RECEPTION_EXPORTEES, CONTACTS_EXPORTES,
          IMPORT_CONTACTS_EXPORTE, PARAMETRES_FACTURATION_EXPORTES, CHANGEMENT_DE_RIB_EXPORTE, LOGO_DES_FACTURES_EXPORTE, reglage, SIMULATION_VENTES_FACTUREES_EXPORTEE,
          devis,
        ))
      }
      expect(/ses devis/.test(ceQueDisentLesCasesDuDossier(BASCULE))).toBe(devis && VENTES_DU_CLIENT_EXPORTEES)
    } finally {
      drapeau.devis = null
    }
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
      const avant = ceQueDisentLesCases(banque, true, articles, false, false, false, false, false, false, BASCULE, false, false)
      const phrase = ceQueDisentLesCases(banque, true, articles, true, false, false, false, false, false, BASCULE, false, false)
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
        expect(ceQueDisentLesCases(banque, false, articles, true, false, false, false, false, false, BASCULE, false, false)).toBe(ceQueDisentLesCases(banque, false, articles, false, false, false, false, false, false, BASCULE, false, false))
      }
      expect(ceQueDisentLesCases(banque, false, false, true, false, false, false, false, false, BASCULE, false, false)).not.toMatch(/adresse de réception|encart/)
    }
  })

  it('les dix états possibles ont dix phrases', () => {
    const phrases = [false, true].flatMap((banque) => [
      ceQueDisentLesCases(banque, false, false, false, false, false, false, false, false, BASCULE, false, false),
      ...[false, true].flatMap((articles) => [false, true].map((adresses) => ceQueDisentLesCases(banque, true, articles, adresses, false, false, false, false, false, BASCULE, false, false))),
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
      const avant = ceQueDisentLesCases(banque, true, articles, adresses, false, false, false, false, false, BASCULE, false, false)
      const phrase = ceQueDisentLesCases(banque, true, articles, adresses, true, false, false, false, false, BASCULE, false, false)
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
      expect(ceQueDisentLesCases(banque, false, articles, adresses, true, false, false, false, false, BASCULE, false, false))
        .toBe(ceQueDisentLesCases(banque, false, articles, adresses, false, false, false, false, false, BASCULE, false, false))
      expect(ceQueDisentLesCases(banque, false, articles, adresses, true, false, false, false, false, BASCULE, false, false)).not.toMatch(/contact|clients/)
    }
  })

  it('les dix-huit états possibles ont dix-huit phrases', () => {
    const phrases = [false, true].flatMap((banque) => [
      ceQueDisentLesCases(banque, false, false, false, false, false, false, false, false, BASCULE, false, false),
      ...[false, true].flatMap((articles) => [false, true].flatMap((adresses) => [false, true]
        .map((contacts) => ceQueDisentLesCases(banque, true, articles, adresses, contacts, false, false, false, false, BASCULE, false, false)))),
    ])
    expect(new Set(phrases).size).toBe(18)
  })

  it('la case « Ventes » ouvre ce que la phrase nomme : le fichier de ses clients et ses gestes, sous la même case', () => {
    expect(ceQueDisentLesCases(true, true, true, true, true, false, false, false, false, BASCULE, false, false)).toContain('« Ventes » ouvre au client « Mes ventes »')
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
      const avant = ceQueDisentLesCases(banque, true, articles, adresses, true, false, false, false, false, BASCULE, false, false)
      const phrase = ceQueDisentLesCases(banque, true, articles, adresses, true, true, false, false, false, BASCULE, false, false)
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
        expect(ceQueDisentLesCases(banque, ventes, articles, adresses, contacts, true, false, false, false, BASCULE, false, false))
          .toBe(ceQueDisentLesCases(banque, ventes, articles, adresses, contacts, false, false, false, false, BASCULE, false, false))
      }
      // « Importé » se dit déjà du relevé de la banque : l'import des contacts se reconnaît à ses propres mots.
      expect(ceQueDisentLesCases(banque, true, articles, adresses, false, true, false, false, false, BASCULE, false, false)).not.toMatch(/importer d’un coup|l’import\b/)
    }
  })

  it('les vingt-six états possibles ont vingt-six phrases', () => {
    const phrases = [false, true].flatMap((banque) => [
      ceQueDisentLesCases(banque, false, false, false, false, false, false, false, false, BASCULE, false, false),
      ...[false, true].flatMap((articles) => [false, true].flatMap((adresses) => [
        ceQueDisentLesCases(banque, true, articles, adresses, false, false, false, false, false, BASCULE, false, false),
        ceQueDisentLesCases(banque, true, articles, adresses, true, false, false, false, false, BASCULE, false, false),
        ceQueDisentLesCases(banque, true, articles, adresses, true, true, false, false, false, BASCULE, false, false),
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

// LES PARAMÈTRES DE FACTURATION (espace client, étape A5a) : leur migration — appliquée sur l'accord du cabinet — ouvre au
// client « Ventes », par la base, les paramètres de facturation du dossier, toutes leurs versions et leurs auteurs, et la
// fonction qui en enregistre une ; un RIB qu'il pose ou change n'y est que proposé, et seul le cabinet le confirme
// (MEG1-Q12, hypothèse). Elle exige les migrations des ventes : sans elles, le drapeau ne change rien à la phrase. Ce que la
// phrase nomme est confronté à l'export dès qu'il porte la migration, et les colonnes qu'elle dit lues, à celles d'une
// version (`src/test/parametresFacturation.ts`, que parametresFacturation.test.ts confronte à l'essai).
const LU_AVEC_PARAMETRES: Record<string, readonly string[]> = {
  'les paramètres de facturation du dossier, version après version': ['parametres_facturation'],
}
const GESTES_AVEC_PARAMETRES: Record<string, readonly string[]> = {
  'peut en enregistrer une avec toi': ['enregistrer_parametres_facturation'],
}
// Chaque colonne d'une version, et les mots qui la disent lue ; la clé, le dossier, la version remplacée et les instants
// sont nommés à part, et toutes ensemble font la ligne.
const COLONNES_DES_PARAMETRES_DITES: Record<string, string> = {
  delai_paiement_jours: 'délai de paiement', moyen_prefere: 'moyen de paiement proposé', escompte: 'conditions d’escompte',
  penalites: 'pénalités de retard', mentions_complementaires: 'mentions complémentaires', pied_de_page: 'pied de page',
  iban: 'IBAN', bic: 'BIC', titulaire_compte: 'titulaire', rib_etat: 'avec son état', rib_confirme_par: 'qui a confirmé chaque RIB',
  auteur: 'qui a enregistré chaque version',
}
const COLONNES_DES_PARAMETRES_SANS_MOT = ['id', 'dossier_id', 'rib_confirme_le', 'remplace_id', 'cree_le']

describe('ce que disent les cases, les paramètres de facturation ouverts (étape A5a)', () => {
  const ETATS_DES_AUTRES = [false, true].flatMap((banque) => [false, true].flatMap((articles) => [false, true]
    .flatMap((adresses) => [false, true].map((contacts) => ({ banque, articles, adresses, contacts })))))

  it.each(ETATS_DES_AUTRES)(
    'banque : $banque, articles : $articles, adresses : $adresses, contacts : $contacts — la phrase d’avant, puis les paramètres, leurs colonnes, leur geste et la règle du RIB',
    ({ banque, articles, adresses, contacts }) => {
      const avant = ceQueDisentLesCases(banque, true, articles, adresses, contacts, contacts, false, false, false, BASCULE, false, false)
      const phrase = ceQueDisentLesCases(banque, true, articles, adresses, contacts, contacts, true, false, false, BASCULE, false, false)
      // Rien de ce que la phrase disait ne se perd : les paramètres s'insèrent après le fichier des clients et son import,
      // avant la banque ; la fin de la phrase ne change pas.
      const debutBanque = (texte: string) => texte.indexOf(banque ? ' « Banque » ouvre au client' : ' « Banque » ne change encore')
      const ajout = phrase.slice(debutBanque(avant), debutBanque(phrase))
      expect(phrase).toBe(avant.slice(0, debutBanque(avant)) + ajout + avant.slice(debutBanque(avant)))
      expect(ajout.startsWith(' Dans « Mes ventes › Paramètres » comme par la base, il lit aussi les paramètres de facturation du '
        + 'dossier, version après version — ')).toBe(true)
      for (const lu of Object.keys(LU_AVEC_PARAMETRES)) expect(ajout).toContain(lu)
      for (const geste of Object.keys(GESTES_AVEC_PARAMETRES)) expect(ajout).toContain(geste)
      // Tout ce que la base lui ouvre, colonne par colonne, et les auteurs.
      const lues = ajout.slice(ajout.indexOf('version après version — '), ajout.indexOf(' — et peut'))
      for (const [colonne, mots] of Object.entries(COLONNES_DES_PARAMETRES_DITES)) expect(lues, colonne).toContain(mots)
      // La règle du RIB (MEG1-Q12, hypothèse) : proposé par lui, confirmé par le cabinet.
      expect(ajout).toContain('un RIB qu’il pose ou change n’est que proposé, jusqu’à ce que tu le confirmes.')
      // Son écran, « Mes ventes › Paramètres », existe depuis l'étape A5b1 : la phrase le nomme, et ne le dit plus à venir.
      expect(ajout.endsWith('jusqu’à ce que tu le confirmes.')).toBe(true)
      expect(ajout).not.toContain('ensuite')
      // Aucun mot que le garde des écrans tient pour une affirmation avant lecture (ecransAvantLecture.test.tsx).
      expect(ajout).not.toMatch(/\b(aucun|aucune|rien)\b/i)
    },
  )

  it('les colonnes que la phrase dit lues, et celles qu’elle tait, font la ligne d’une version', () => {
    expect([...Object.keys(COLONNES_DES_PARAMETRES_DITES), ...COLONNES_DES_PARAMETRES_SANS_MOT].sort())
      .toEqual(Object.keys(versionParametres()).sort())
  })

  it('sans les ventes, le drapeau des paramètres ne change rien : leur migration exige celles des ventes', () => {
    for (const { banque, articles, adresses, contacts } of ETATS_DES_AUTRES) {
      expect(ceQueDisentLesCases(banque, false, articles, adresses, contacts, contacts, true, false, false, BASCULE, false, false))
        .toBe(ceQueDisentLesCases(banque, false, articles, adresses, contacts, contacts, false, false, false, BASCULE, false, false))
      expect(ceQueDisentLesCases(banque, false, articles, adresses, contacts, contacts, true, false, false, BASCULE, false, false)).not.toMatch(/paramètres de facturation|RIB/)
    }
  })

  it('les trente-quatre états possibles ont trente-quatre phrases', () => {
    const phrases = [false, true].flatMap((banque) => [
      ceQueDisentLesCases(banque, false, false, false, false, false, false, false, false, BASCULE, false, false),
      ...[false, true].flatMap((articles) => [false, true].flatMap((adresses) => [false, true].flatMap((contacts) => [false, true]
        .map((parametres) => ceQueDisentLesCases(banque, true, articles, adresses, contacts, false, parametres, false, false, BASCULE, false, false))))),
    ])
    expect(new Set(phrases).size).toBe(34)
  })

  // Le drapeau dit ce que porte l'export (parametresFacturation.test.ts le garde aussi) ; levé, la lecture que la phrase
  // nomme est ouverte au droit « Ventes », et l'enregistrement est une fonction qui l'accepte, l'accès d'abord — la
  // confirmation du RIB, elle, reste au cabinet.
  it('les paramètres ouverts : leur lecture et leur enregistrement, l’export les ouvre à « Ventes » ; la confirmation, au cabinet seul', () => {
    const porte = (motif: RegExp) => fichiersDuSchema().some((f) => motif.test(f.texte))
    expect(porte(/create table public\.parametres_facturation \(/), 'PARAMETRES_FACTURATION_EXPORTES ne dit plus ce que porte l’export')
      .toBe(PARAMETRES_FACTURATION_EXPORTES)
    if (!PARAMETRES_FACTURATION_EXPORTES) return
    expect(VENTES_DU_CLIENT_EXPORTEES, 'la migration des paramètres exige celles des ventes').toBe(true)
    for (const table of Object.values(LU_AVEC_PARAMETRES).flat()) {
      expect(porte(new RegExp(`create policy ${table}_lecture_ventes on public\\.${table}\\s+for select to authenticated\\s+using \\(public\\.client_du_dossier\\(dossier_id, 'ventes'\\)\\);`)), table)
        .toBe(true)
    }
    for (const fonction of Object.values(GESTES_AVEC_PARAMETRES).flat()) {
      expect(derniereDefinitionSql(fonction), fonction)
        .toMatch(/\$\$\s*(declare\s(?:(?!\bbegin\b)[\s\S])*)?\bbegin\s+if not public\.gere_les_ventes\(p_dossier_id\) or not exists/)
    }
    expect(derniereDefinitionSql('confirmer_rib'))
      .toMatch(/\$\$\s*(declare\s(?:(?!\bbegin\b)[\s\S])*)?\bbegin\s+if not public\.admin_du_dossier\(p_dossier_id\) or not exists/)
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
    const avant = ceQueDisentLesCases(banque, true, false, false, false, false, false, false, false, BASCULE, false, DEVIS_EXPORTES)
    const phrase = ceQueDisentLesCases(banque, true, true, false, false, false, false, false, false, BASCULE, false, DEVIS_EXPORTES)
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
    // Drapeau baissé, les devis n'existent pas encore (étape P5) : seul le préfixe, qui dit ce que la case OUVRIRA, les nomme.
    expect(phrase).not.toMatch(/sans écran/)
    if (!DEVIS_EXPORTES) expect(phrase.slice(phrase.indexOf('une case cochée'))).not.toMatch(/devis/)
  })

  it('sans les ventes, le drapeau des articles ne change rien : leur migration exige celles des ventes', () => {
    for (const banque of [false, true]) {
      expect(ceQueDisentLesCases(banque, false, true, false, false, false, false, false, false, BASCULE, false, false)).toBe(ceQueDisentLesCases(banque, false, false, false, false, false, false, false, false, BASCULE, false, false))
      expect(ceQueDisentLesCases(banque, false, true, false, false, false, false, false, false, BASCULE, false, false)).not.toMatch(/article/)
    }
  })

  it('les six états possibles ont six phrases', () => {
    const phrases = [false, true].flatMap((banque) => [
      ceQueDisentLesCases(banque, false, false, false, false, false, false, false, false, BASCULE, false, false), ceQueDisentLesCases(banque, true, false, false, false, false, false, false, false, BASCULE, false, false), ceQueDisentLesCases(banque, true, true, false, false, false, false, false, false, BASCULE, false, false),
    ])
    expect(new Set(phrases).size).toBe(6)
  })

  it('la case « Ventes » ouvre ce que la phrase nomme : la lecture du catalogue et ses gestes, sous la même case', () => {
    expect(ceQueDisentLesCases(true, true, true, false, false, false, false, false, false, BASCULE, false, false)).toContain('« Ventes » ouvre au client « Mes ventes »')
  })
})

// LES DEVIS (espace client, étape P5) : leurs deux migrations ouvrent au client « Ventes », par la base, la lecture de ses
// devis et du lien de chacun à sa facture, et quatre gestes ; aucun écran encore (étape P6). Le paramètre se joue dans
// ses deux états : levé, la phrase des ventes les nomme, sans écran ; baissé, la phrase est celle d'avant, au caractère près.
describe('ce que disent les cases, les devis ouverts (étape P5)', () => {
  const DEBUT = ' Par la base, il lit aussi ses devis'
  const FIN = 'dans le même plafond que ses factures.'

  it.each([false, true])('banque ouverte : %s — la phrase des ventes, puis ses devis, leur lien et leurs quatre gestes, et rien d’autre', (banque) => {
    const avant = ceQueDisentLesCases(banque, true, true, true, true, true, true, true, true, BASCULE, true, false)
    const phrase = ceQueDisentLesCases(banque, true, true, true, true, true, true, true, true, BASCULE, true, true)
    for (const lu of Object.keys(LU_AVEC_DEVIS)) expect(phrase).toContain(lu)
    for (const geste of Object.keys(GESTES_AVEC_DEVIS)) expect(phrase).toContain(geste)
    const debut = phrase.indexOf(DEBUT)
    const fin = phrase.indexOf(FIN, debut) + FIN.length
    expect(debut).toBeGreaterThan(0)
    // La phrase des devis s'insère après celle des ventes, et rien d'autre ne change.
    expect(phrase.slice(0, debut) + phrase.slice(fin)).toBe(avant)
    expect(phrase.slice(0, debut).endsWith('trente par dossier et par jour au plus.')).toBe(true)
    // Aucun écran ne les montre encore : la phrase n'en nomme aucun, et ne les dit pas à venir.
    expect(phrase.slice(debut, fin)).not.toMatch(/«|écran|ensuite/)
    // Drapeau baissé : plus un mot des devis après le préfixe.
    expect(avant.slice(avant.indexOf('une case cochée'))).not.toMatch(/devis/)
  })

  it('sans les ventes, le drapeau des devis ne change rien : leurs migrations exigent celles des ventes', () => {
    for (const banque of [false, true]) {
      expect(ceQueDisentLesCases(banque, false, true, true, true, true, true, true, true, BASCULE, true, true))
        .toBe(ceQueDisentLesCases(banque, false, true, true, true, true, true, true, true, BASCULE, true, false))
    }
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
    const enAttente = (f: string, a: string) => PAS_ENCORE_NOMMEES.some(([fe, ae]) => fe === f && ae === a)
    expect(PAS_ENCORE_NOMMEES.length, 'les actions de la vente que la phrase ne nomme pas encore').toBe((ENVOI_DES_DEVIS_PREVU ? 0 : 1) + (RELANCES_EXPORTEES ? 0 : 1))
    for (const [fonction, table] of Object.entries(QUI_PEUT_QUOI_ATTENDU)) {
      for (const [action, droit] of Object.entries(table)) {
        const nommee = nommees.some(([f, a]) => f === fonction && a === action)
        if (enAttente(fonction, action)) {
          // Ouverte à « Ventes » par la table, et pas encore dite : jamais les deux à la fois en défaut.
          expect(droit, `${fonction} › ${action}`).toBe('ventes')
          expect(nommee, `${fonction} › ${action} : nommée alors qu'elle attend sa migration`).toBe(false)
          continue
        }
        expect(nommee, `${fonction} › ${action}`).toBe(droit === 'ventes')
      }
    }
  })

  it('le plafond que la phrase dit est celui de send-email', () => {
    const source = readFileSync(resolve(process.cwd(), 'supabase/functions/send-email/index.ts'), 'utf8')
    expect(source.match(/const PLAFOND_CLIENT_PAR_JOUR = (\d+)\n/)?.[1]).toBe('30')
    expect(ceQueDisentLesCases(false, true, false, false, false, false, false, false, false, BASCULE, false, false)).toContain('trente par dossier et par jour au plus')
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
    // Depuis l'étape A1, la lecture des articles aussi, depuis l'étape A6a celle des adresses de réception, depuis
    // l'étape A4a celle des contacts, et depuis l'étape A5a celle des paramètres de facturation, le jour où l'export
    // porte leur migration.
    expect(policies.map((p) => p[1]).sort()).toEqual([
      ...Object.values(LU_AVEC_VENTES).flat(),
      ...(ARTICLES_EXPORTES ? Object.values(LU_AVEC_ARTICLES).flat() : []),
      ...(ADRESSES_RECEPTION_EXPORTEES ? Object.values(LU_AVEC_ADRESSES).flat() : []),
      ...(CONTACTS_EXPORTES ? Object.values(LU_AVEC_CONTACTS).flat() : []),
      ...(PARAMETRES_FACTURATION_EXPORTES ? Object.values(LU_AVEC_PARAMETRES).flat() : []),
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
    [LIBELLE_NOTES_DEVIS, 'elles ne figurent pas sur le devis', 'les lit'],
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
    expect(new Set(LIBELLES.map(([l]) => l)).size).toBe(10)
  })

  it('la phrase des cases dit lus les textes que les libellés disent lus', () => {
    for (const banque of [false, true]) {
      for (const articles of [false, true]) {
        expect(ceQueDisentLesCases(banque, true, articles, false, false, false, false, false, false, BASCULE, false, false)).toContain('avec ce que le cabinet y a écrit (notes et motifs)')
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

// Les cinq textes libres des PARAMÈTRES DE FACTURATION (étape A5b1) : au cabinet, chacun dit que le client qui porte « Ventes »
// le lit ; au client, que son cabinet le lit aussi — et la policy qui l'ouvre à « Ventes » est dans l'export.
describe('les textes libres des paramètres de facturation : chaque libellé dit qui le lit', () => {
  const PAIRES: [string, string, string, string][] = [
    [LIBELLE_ESCOMPTE_PARAMETRES, LIBELLE_ESCOMPTE_PARAMETRES_CLIENT, 'Conditions d’escompte', 'les lit'],
    [LIBELLE_PENALITES_PARAMETRES, LIBELLE_PENALITES_PARAMETRES_CLIENT, 'Pénalités de retard', 'les lit'],
    [LIBELLE_MENTIONS_PARAMETRES, LIBELLE_MENTIONS_PARAMETRES_CLIENT, 'Mentions complémentaires', 'les lit'],
    [LIBELLE_PIED_DE_PAGE_PARAMETRES, LIBELLE_PIED_DE_PAGE_PARAMETRES_CLIENT, 'Pied de page', 'le lit'],
    [LIBELLE_TITULAIRE_PARAMETRES, LIBELLE_TITULAIRE_PARAMETRES_CLIENT, 'Titulaire du compte', 'le lit'],
  ]

  it('au cabinet, le client qui porte « Ventes » ; au client, son cabinet aussi — jamais un mot du cabinet', () => {
    for (const [cabinet, client, champ, lit] of PAIRES) {
      expect(cabinet).toContain(champ)
      expect(cabinet).toContain(`le client qui porte la case « ${definitionDe('ventes').libelle} » ${lit}`)
      expect(client).toContain(champ)
      expect(client).toContain(`ton cabinet ${lit} aussi`)
      expect(motsDuCabinet(client)).toEqual([])
    }
    expect(new Set(PAIRES.flatMap(([a, b]) => [a, b])).size).toBe(10)
  })

  it('la table qu’ils décrivent est ouverte à « Ventes » par l’export', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/schema/20261016064317_parametres_facturation.sql'), 'utf8')
    expect(migration).toMatch(/create policy parametres_facturation_lecture_ventes on public\.parametres_facturation\s+for select to authenticated using \(public\.client_du_dossier\(dossier_id, 'ventes'\)\)/)
  })
})

// Les trois textes libres de l'IDENTITÉ du dossier (étape A5b2) : l'adresse, la dénomination imprimée et la ville du greffe
// vivent sur `dossiers`, que la dernière policy de lecture ouvre à tout compte qui porte un accès du dossier — pas au seul
// client « Ventes » : le libellé dit « le client du dossier », jamais la case.
describe('les textes libres de l’identité du dossier : chaque libellé dit que le client du dossier les lit', () => {
  it('nomme le client du dossier et le champ — sans parler d’une case, que `dossiers_select` ne connaît pas', () => {
    expect(LIBELLE_ADRESSE_IDENTITE).toBe('Adresse (le client du dossier la lit)')
    expect(LIBELLE_DENOMINATION_IDENTITE).toBe('Dénomination imprimée (facultative ; le client du dossier la lit)')
    expect(LIBELLE_RCS_VILLE_IDENTITE).toBe('Ville du greffe (RCS ; facultative ; le client du dossier la lit)')
    for (const libelle of [LIBELLE_ADRESSE_IDENTITE, LIBELLE_DENOMINATION_IDENTITE, LIBELLE_RCS_VILLE_IDENTITE]) {
      expect(libelle).not.toMatch(/case|intern/i)
    }
  })

  it('la dernière policy de lecture de `dossiers` ouvre la ligne à tout accès du dossier, la dernière d’écriture au cabinet seul', () => {
    const derniere = (motif: RegExp) => {
      const trouvees = fichiersDuSchema().filter((f) => motif.test(f.texte))
      const texte = trouvees[trouvees.length - 1]?.texte ?? ''
      return (texte.match(new RegExp(motif.source + '[^;]*;', 'g')) ?? []).pop() ?? ''
    }
    expect(derniere(/create policy dossiers_select on (?:public\.)?dossiers for select/))
      .toMatch(/using \(admin_du_dossier\(id\) or exists \(select 1 from memberships m where m\.dossier_id = dossiers\.id and m\.user_id = auth\.uid\(\)\)\)/)
    expect(derniere(/create policy dossiers_update on (?:public\.)?dossiers for update/))
      .toMatch(/using \(admin_du_dossier\(id\)\) with check \(admin_du_dossier\(id\)\)/)
  })

  it('les quatre colonnes de l’identité légale vivent sur `dossiers`, dans l’export', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/schema/20261016064317_parametres_facturation.sql'), 'utf8')
    for (const colonne of ['denomination_imprimee text', 'rcs_ville text', 'forme_juridique text', 'capital numeric']) {
      expect(migration, colonne).toContain(`add column ${colonne}`)
    }
  })
})

// LE DERNIER CHANGEMENT DU RIB (espace client, étape A5b3a) : sa migration ouvre à la case « Banque », par une fonction de la
// base, le jour, l'auteur (le cabinet ou un accès client, jamais la personne) et l'état du dernier changement du RIB des
// factures, jamais le RIB lui-même (A5-Q2). La phrase le dit dans ce que « Banque » ouvre ; elle exige les paramètres (A5a),
// donc les ventes, et la banque du client (P7) : sans l'une d'elles, le drapeau ne change rien à la phrase. Ce qu'elle nomme
// est confronté à l'export dès qu'il porte la migration.
const PHRASE_DU_CHANGEMENT_DE_RIB = ' Par la base, elle lui dit aussi le jour, l’auteur — toi, ou un accès client, jamais la personne — et '
  + 'l’état du dernier changement du RIB de ses factures, sans jamais lui montrer ce RIB ; son accueil le lui dit pendant '
  + 'trente jours.'

describe('ce que disent les cases, le dernier changement du RIB ouvert (étape A5b3a)', () => {
  const ETATS_DES_AUTRES = [false, true].flatMap((articles) => [false, true].flatMap((adresses) => [false, true]
    .map((contacts) => ({ articles, adresses, contacts }))))

  it.each(ETATS_DES_AUTRES)(
    'articles : $articles, adresses : $adresses, contacts : $contacts — la phrase d’avant, et ce que « Banque » dit du RIB, après la simulation',
    ({ articles, adresses, contacts }) => {
      const avant = ceQueDisentLesCases(true, true, articles, adresses, contacts, contacts, true, false, false, BASCULE, false, false)
      const phrase = ceQueDisentLesCases(true, true, articles, adresses, contacts, contacts, true, true, false, BASCULE, false, false)
      const apresLaSimulation = (texte: string) => texte.indexOf(' La case lui ouvre aussi sa simulation.') + ' La case lui ouvre aussi sa simulation.'.length
      // Rien de ce que la phrase disait ne se perd : le RIB s'insère juste après la simulation, dans ce que « Banque » ouvre.
      expect(phrase).toBe(avant.slice(0, apresLaSimulation(avant)) + PHRASE_DU_CHANGEMENT_DE_RIB + avant.slice(apresLaSimulation(avant)))
      // Jamais le RIB, jamais la personne ; aucun mot que le garde des écrans tient pour une affirmation avant lecture.
      expect(PHRASE_DU_CHANGEMENT_DE_RIB).not.toMatch(/IBAN|BIC|titulaire/)
      expect(PHRASE_DU_CHANGEMENT_DE_RIB).not.toMatch(/\b(aucun|aucune|rien)\b/i)
      // L'avis est sur l'accueil (étape A5b3b) : la phrase ne le dit plus à venir, et ne promet rien d'autre (ni lien, ni écran).
      expect(PHRASE_DU_CHANGEMENT_DE_RIB).not.toMatch(/viendr|ensuite|dira/)
      expect(PHRASE_DU_CHANGEMENT_DE_RIB).not.toMatch(/\b(lien|écran|bouton)\b/)
      // Sa durée est celle du module (A5B3-Q4) : elle est dite en jours, et le nombre est celui de la règle.
      expect(DUREE_DE_L_AVIS_EN_JOURS).toBe(30)
      expect(PHRASE_DU_CHANGEMENT_DE_RIB).toContain('pendant trente jours')
    },
  )

  it('sans la banque du client, sans les ventes ou sans les paramètres, le drapeau ne change rien', () => {
    for (const { articles, adresses, contacts } of ETATS_DES_AUTRES) {
      for (const [banque, ventes, parametres] of [[false, true, true], [true, false, true], [true, false, false], [true, true, false], [false, false, false]]) {
        expect(ceQueDisentLesCases(banque, ventes, articles, adresses, contacts, contacts, parametres, true, false, BASCULE, false, false), `${banque} ${ventes} ${parametres}`)
          .toBe(ceQueDisentLesCases(banque, ventes, articles, adresses, contacts, contacts, parametres, false, false, BASCULE, false, false))
      }
    }
    expect(ceQueDisentLesCases(false, true, true, true, true, true, true, true, false, BASCULE, false, false)).not.toContain('dernier changement du RIB')
  })

  it('la phrase de l’onglet ne le dit que drapeau levé', () => {
    expect(ceQueDisentLesCasesDuDossier(BASCULE).includes(PHRASE_DU_CHANGEMENT_DE_RIB)).toBe(CHANGEMENT_DE_RIB_EXPORTE && COUVERTURE_EXPORTEE
      && VENTES_DU_CLIENT_EXPORTEES && PARAMETRES_FACTURATION_EXPORTES)
  })

  // Le drapeau dit ce que porte l'export (changementDeRib.test.ts le garde aussi) ; levé, la fonction que la phrase nomme
  // est ouverte à la case « Banque », l'accès d'abord, et la migration exige celle des paramètres.
  it('le dernier changement ouvert : la fonction que la phrase nomme, l’export l’ouvre à « Banque », l’accès d’abord', () => {
    const porte = (motif: RegExp) => fichiersDuSchema().some((f) => motif.test(f.texte))
    expect(porte(/create function public\.dernier_changement_de_rib\(/), 'CHANGEMENT_DE_RIB_EXPORTE ne dit plus ce que porte l’export')
      .toBe(CHANGEMENT_DE_RIB_EXPORTE)
    if (!CHANGEMENT_DE_RIB_EXPORTE) return
    expect(PARAMETRES_FACTURATION_EXPORTES, 'la migration du dernier changement du RIB exige celle des paramètres').toBe(true)
    expect(derniereDefinitionSql('dernier_changement_de_rib'))
      .toMatch(/\bbegin\s+if not \(public\.admin_du_dossier\(p_dossier_id\)\s+or public\.client_du_dossier\(p_dossier_id, 'ventes'\)\s+or public\.client_du_dossier\(p_dossier_id, 'banque'\)\)/)
  })
})

// LE LOGO DES FACTURES (espace client, étape A5c1) : sa migration ouvre au client « Ventes », par le stockage et par la base,
// la lecture du seau des ventes de son dossier, le dépôt d'un logo et sa désignation dans une version des paramètres ; aucun
// fichier ne s'y met à jour, et seul le chef du cabinet en supprime. La phrase le dit après les paramètres, dans ce que
// « Ventes » ouvre ; elle exige les paramètres (A5a), donc les ventes : sans eux, le drapeau ne change rien à la phrase. Ce
// qu'elle nomme est confronté à l'export dès qu'il porte la migration. Depuis l'étape A5c2a, elle situe l'écran du logo
// (« Mes ventes › Paramètres ») et ne le dit plus à venir.
const PHRASE_DU_LOGO = ' Dans « Mes ventes › Paramètres » comme par la base, il peut aussi déposer le logo de ses factures — une image PNG ou '
  + 'JPEG de 500 Ko au plus — dans le stockage des ventes du dossier, où il lit ce qui y est déposé, et le désigner dans '
  + 'une version des paramètres ; un fichier déposé ne se remplace pas, et lui ne peut pas l’effacer.'

describe('ce que disent les cases, le logo des factures ouvert (étape A5c1)', () => {
  const ETATS_DES_AUTRES = [false, true].flatMap((banque) => [false, true].flatMap((articles) => [false, true]
    .flatMap((contacts) => [false, true].map((rib) => ({ banque, articles, contacts, rib })))))

  it.each(ETATS_DES_AUTRES)(
    'banque : $banque, articles : $articles, contacts : $contacts, RIB : $rib — la phrase d’avant, et le logo juste après les paramètres',
    ({ banque, articles, contacts, rib }) => {
      const avant = ceQueDisentLesCases(banque, true, articles, articles, contacts, contacts, true, rib, false, BASCULE, false, false)
      const phrase = ceQueDisentLesCases(banque, true, articles, articles, contacts, contacts, true, rib, true, BASCULE, false, false)
      const finDesParametres = (texte: string) => texte.indexOf('jusqu’à ce que tu le confirmes.') + 'jusqu’à ce que tu le confirmes.'.length
      // Rien de ce que la phrase disait ne se perd : le logo s'insère juste après les paramètres, avant la banque.
      expect(phrase).toBe(avant.slice(0, finDesParametres(avant)) + PHRASE_DU_LOGO + avant.slice(finDesParametres(avant)))
      // Ce qu'il ouvre : la lecture, le dépôt, la désignation ; ce qu'il ferme : remplacer, effacer.
      for (const mot of ['« Mes ventes › Paramètres »', 'déposer le logo de ses factures', 'PNG ou JPEG', '500 Ko',
        'où il lit ce qui y est déposé', 'le désigner dans une version des paramètres', 'ne se remplace pas', 'ne peut pas l’effacer']) {
        expect(PHRASE_DU_LOGO, mot).toContain(mot)
      }
      // Jamais le SVG ni le WebP ; l'écran existe (A5c2a) : rien n'en est dit à venir ; aucun mot que le garde des écrans tient
      // pour une affirmation avant lecture (ecransAvantLecture.test.tsx).
      expect(PHRASE_DU_LOGO).not.toMatch(/SVG|WebP/)
      expect(PHRASE_DU_LOGO).not.toMatch(/viendra|à venir/)
      expect(PHRASE_DU_LOGO).toMatch(/ne peut pas l’effacer\.$/)
      expect(PHRASE_DU_LOGO).not.toMatch(/\b(aucun|aucune|rien)\b/i)
    },
  )

  it('sans les ventes ou sans les paramètres, le drapeau du logo ne change rien : sa migration exige la leur', () => {
    for (const { banque, articles, contacts, rib } of ETATS_DES_AUTRES) {
      for (const [ventes, parametres] of [[false, true], [true, false], [false, false]]) {
        expect(ceQueDisentLesCases(banque, ventes, articles, articles, contacts, contacts, parametres, rib, true, BASCULE, false, false), `${ventes} ${parametres}`)
          .toBe(ceQueDisentLesCases(banque, ventes, articles, articles, contacts, contacts, parametres, rib, false, BASCULE, false, false))
      }
    }
    expect(ceQueDisentLesCases(true, false, true, true, true, true, true, true, true, BASCULE, false, false)).not.toContain('logo')
  })

  it('la phrase de l’onglet ne le dit que drapeau levé', () => {
    expect(ceQueDisentLesCasesDuDossier(BASCULE).includes(PHRASE_DU_LOGO)).toBe(LOGO_DES_FACTURES_EXPORTE && VENTES_DU_CLIENT_EXPORTEES
      && PARAMETRES_FACTURATION_EXPORTES)
  })

  // Le drapeau dit ce que porte l'export (logoDesFactures.test.ts le garde aussi) ; levé, le seau est privé et borné aux
  // deux types, sa lecture et son dépôt sont ouverts à « Ventes », aucune policy n'y met un fichier à jour, la suppression
  // reste au chef du cabinet, et la fonction des paramètres admet le logo, l'accès d'abord.
  it('le logo ouvert : ce que la phrase nomme, l’export l’ouvre à « Ventes », et rien de ce qu’elle ferme', () => {
    const migrations = fichiersDuSchema().filter((f) => /\/\d{14}_logo_des_factures\.sql$/.test(f.chemin))
    expect(migrations.length === 1, 'LOGO_DES_FACTURES_EXPORTE ne dit plus ce que porte l’export').toBe(LOGO_DES_FACTURES_EXPORTE)
    if (!LOGO_DES_FACTURES_EXPORTE) return
    expect(PARAMETRES_FACTURATION_EXPORTES, 'la migration du logo exige celle des paramètres').toBe(true)
    const texte = migrations[0].texte.replace(/\s+/g, ' ')
    expect(texte).toContain("values ('ventes', 'ventes', false, 512000, array['image/png', 'image/jpeg'])")
    expect(texte).toMatch(/create policy ventes_lecture on storage\.objects for select to authenticated using \(bucket_id = 'ventes' and case when [^;]* then public\.gere_les_ventes\(/)
    expect(texte).toMatch(/create policy ventes_depot_d_un_logo on storage\.objects for insert to authenticated with check \(bucket_id = 'ventes' and case when [^;]*\/logos\/[^;]* then public\.gere_les_ventes\(/)
    expect(texte).toMatch(/create policy ventes_suppression_par_le_chef on storage\.objects for delete to authenticated using \([^;]*public\.est_chef_du_cabinet\(d\.cabinet_id\)/)
    expect(texte).not.toMatch(/create policy \w+ on storage\.objects for (update|all)\b/)
    expect(derniereDefinitionSql('enregistrer_parametres_facturation'))
      .toMatch(/\$\$\s*(declare\s(?:(?!\bbegin\b)[\s\S])*)?\bbegin\s+if not public\.gere_les_ventes\(p_dossier_id\) or not exists/)
  })
})

// LA CASE « VENTES » SUIT LA SOURCE DES VENTES DU DOSSIER (chantier EC-Q3, étape VF8d ; HISTORIQUE.md, « VF8, LA BASCULE :
// LA CONCEPTION », § 3 (d)). Ce qui se garde ici : le réglage lu sans jamais deviner, les gestes de chaque case dans les trois
// états, la phrase de l'onglet qui les dit, et ce qu'elle redit de la base — confronté à l'export.
const NON_BASCULE: ReglageDuDossier = { etat: 'non_bascule' }
const ILLISIBLE: ReglageDuDossier = { etat: 'illisible', motif: 'lecture refusée' }
const LES_TROIS_REGLAGES = [BASCULE, NON_BASCULE, ILLISIBLE] as const

// LES VENTES FACTURÉES DE LA SIMULATION (chantier EC-Q3, étape VF8e ; VF8-Q2) : la migration
// `simulation_des_ventes_facturees` ouvre à la case « Banque », par une fonction de lecture, d'un dossier dont les factures
// sont la source de leurs ventes, le total hors taxe de chaque mois de ses ventes facturées et la liste de ses factures et
// avoirs sources ; « Ma simulation » les compte. La phrase le dit à la place de « La case lui ouvre aussi sa simulation. » ;
// sans la banque du client (P7), le drapeau ne change rien. Il reste faux tant que la migration, préparée, n'est pas
// appliquée : ses deux états se jouent ici par la doublure du module.
describe('ce que disent les cases, les ventes facturées de la simulation ouvertes (étape VF8e)', () => {
  const ETATS_DES_AUTRES = [false, true].flatMap((ventes) => [false, true].flatMap((parametres) => [false, true]
    .map((rib) => ({ ventes, parametres, rib }))))

  it.each(ETATS_DES_AUTRES)(
    'ventes : $ventes, paramètres : $parametres, RIB : $rib — la phrase d’avant, la simulation dite avec ce qu’elle compte',
    ({ ventes, parametres, rib }) => {
      const avant = ceQueDisentLesCases(true, ventes, ventes, ventes, ventes, ventes, parametres, rib, false, BASCULE, false, false)
      const phrase = ceQueDisentLesCases(true, ventes, ventes, ventes, ventes, ventes, parametres, rib, false, BASCULE, true, false)
      // Rien de ce que la phrase disait ne se perd : seule la simulation se dit avec ce qu'elle compte de plus.
      expect(avant.split(' La case lui ouvre aussi sa simulation.').length).toBe(2)
      expect(phrase).toBe(avant.replace(' La case lui ouvre aussi sa simulation.', PHRASE_DES_VENTES_DE_LA_SIMULATION))
    },
  )

  it('ce qu’elle dit : le total de chaque mois et des identifiants, jamais leur contenu ; aucun mot d’une affirmation du vide', () => {
    expect(PHRASE_DES_VENTES_DE_LA_SIMULATION.startsWith(' La case lui ouvre aussi sa simulation, ')).toBe(true)
    expect(PHRASE_DES_VENTES_DE_LA_SIMULATION).toContain('d’un dossier dont les factures sont la source de leurs ventes')
    expect(PHRASE_DES_VENTES_DE_LA_SIMULATION).toContain('le total hors taxe de chaque mois')
    expect(PHRASE_DES_VENTES_DE_LA_SIMULATION).toContain('leurs identifiants, sans leur contenu.')
    expect(PHRASE_DES_VENTES_DE_LA_SIMULATION).not.toMatch(/\b(aucun|aucune|rien)\b/i)
    expect(PHRASE_DES_VENTES_DE_LA_SIMULATION).not.toMatch(/\b(numéro|client|montant)\b/)
  })

  it('sans la banque du client, le drapeau ne change rien : la fonction ne s’ouvre qu’à la case « Banque »', () => {
    for (const ventes of [false, true]) {
      expect(ceQueDisentLesCases(false, ventes, ventes, ventes, ventes, ventes, ventes, ventes, ventes, BASCULE, true, false), `${ventes}`)
        .toBe(ceQueDisentLesCases(false, ventes, ventes, ventes, ventes, ventes, ventes, ventes, ventes, BASCULE, false, false))
    }
    expect(ceQueDisentLesCases(false, true, true, true, true, true, true, true, true, BASCULE, true, false)).not.toContain('simulation')
  })

  it('la phrase de l’onglet ne le dit que drapeau levé : ses deux états, sous les trois réglages', () => {
    try {
      for (const leve of [false, true]) {
        drapeau.simulation = leve
        for (const reglage of [BASCULE, { etat: 'non_bascule' }, { etat: 'illisible', motif: 'lecture refusée' }] as const) {
          const phrase = ceQueDisentLesCasesDuDossier(reglage)
          expect(phrase.includes(PHRASE_DES_VENTES_DE_LA_SIMULATION), `${leve} ${reglage.etat}`).toBe(leve && COUVERTURE_EXPORTEE)
          expect(phrase.includes(' La case lui ouvre aussi sa simulation.'), `${leve} ${reglage.etat}`).toBe(!leve && COUVERTURE_EXPORTEE)
        }
      }
    } finally {
      drapeau.simulation = null
    }
  })

  it('la fonction qu’elle dit : dans l’export, ouverte à la case « Banque », l’accès jugé avant toute lecture', () => {
    expect(fichiersDuSchema().some((f) => /create function public\.ventes_facturees_de_la_simulation\(/.test(f.texte))).toBe(true)
    expect(derniereDefinitionSql('ventes_facturees_de_la_simulation'))
      .toMatch(/\bbegin\s+(--[^\n]*\n\s*)*if not public\.gere_la_banque\(p_dossier_id\) or not exists \(select 1 from public\.dossiers d where d\.id = p_dossier_id\) then/)
  })
})

describe('la case « Ventes » et la source des ventes du dossier (étape VF8d)', () => {
  it('seuls vrai et faux se lisent : une ligne absente, une colonne absente, nulle ou d’un autre type est illisible', () => {
    expect(reglageDuDossier({ ventes_par_les_factures: true })).toEqual({ etat: 'bascule' })
    expect(reglageDuDossier({ ventes_par_les_factures: false })).toEqual({ etat: 'non_bascule' })
    expect(reglageDuDossier(null)).toEqual({ etat: 'illisible', motif: 'le dossier n’a pas été trouvé' })
    for (const valeur of [undefined, null, 'true', 'false', 1, 0]) {
      expect(reglageDuDossier({ ventes_par_les_factures: valeur }), String(valeur))
        .toEqual({ etat: 'illisible', motif: 'le réglage n’est pas lisible' })
    }
    expect(reglageDuDossier({})).toEqual({ etat: 'illisible', motif: 'le réglage n’est pas lisible' })
  })

  it('« Banque » garde ses deux gestes quel que soit le réglage', () => {
    for (const reglage of LES_TROIS_REGLAGES) {
      expect(gesteDeLaCase('banque', reglage, EXONERE)).toEqual({ cocher: true, decocher: true, raison: null })
      expect(refusDeLaCase('banque', true, reglage, EXONERE)).toBeNull()
      expect(refusDeLaCase('banque', false, reglage, EXONERE)).toBeNull()
    }
  })

  it('« Ventes » : basculé, les deux gestes ; non basculé, décocher seulement, et pourquoi ; illisible, aucun, et pourquoi', () => {
    expect(gesteDeLaCase('ventes', BASCULE, EXONERE)).toEqual({ cocher: true, decocher: true, raison: null })
    expect(gesteDeLaCase('ventes', NON_BASCULE, EXONERE)).toEqual({
      cocher: false, decocher: true, raison: raisonDuDossierNonBascule(BASCULE_OFFERTE),
    })
    expect(gesteDeLaCase('ventes', ILLISIBLE, EXONERE)).toEqual({
      cocher: false, decocher: false, raison: raisonDuReglageIllisible('lecture refusée'),
    })
    expect(refusDeLaCase('ventes', true, BASCULE, EXONERE)).toBeNull()
    expect(refusDeLaCase('ventes', false, BASCULE, EXONERE)).toBeNull()
    // Cocher « Ventes » sur un dossier qui n'a pas basculé : le refus de la base, à la lettre (étape VF8f) — pas la raison de
    // la case grisée, qui dit où le réglage se pose.
    expect(refusDeLaCase('ventes', true, NON_BASCULE, EXONERE)).toBe(REFUS_VENTES_DOSSIER_NON_BASCULE.message)
    expect(refusDeLaCase('ventes', false, NON_BASCULE, EXONERE)).toBeNull()
    expect(refusDeLaCase('ventes', true, ILLISIBLE, EXONERE)).toBe(raisonDuReglageIllisible('lecture refusée'))
    expect(refusDeLaCase('ventes', false, ILLISIBLE, EXONERE)).toBe(raisonDuReglageIllisible('lecture refusée'))
  })

  it('les raisons disent ce qui ouvre la case, où le réglage se pose, et le motif d’un réglage illisible', () => {
    expect(raisonDuDossierNonBascule(true)).toBe('La case « Ventes » s’ouvre quand les factures de ce dossier sont la source de '
      + 'leurs ventes (onglet Informations) : d’ici là, elle ne se coche pas, et un accès qui la porte déjà se décoche.')
    expect(raisonDuDossierNonBascule(false)).toBe('La case « Ventes » s’ouvre quand les factures de ce dossier sont la source de '
      + 'leurs ventes — un réglage que le chef du cabinet posera dans l’onglet Informations, où il ne s’offre pas encore : '
      + 'd’ici là, elle ne se coche pas, et un accès qui la porte déjà se décoche.')
    expect(raisonDuReglageIllisible('le dossier n’a pas été trouvé')).toBe('La source des ventes de ce dossier ne se lit pas '
      + '(le dossier n’a pas été trouvé) : la case « Ventes » ne se coche ni ne se décoche d’ici. Recharge la page pour la relire.')
    expect(phraseDuReglage(BASCULE)).toBe(CE_QUE_COMPTENT_SES_FACTURES)
    expect(phraseDuReglage(NON_BASCULE)).toBe(raisonDuDossierNonBascule(BASCULE_OFFERTE))
    expect(phraseDuReglage(ILLISIBLE)).toBe(raisonDuReglageIllisible('lecture refusée'))
    // EC3-Q5 : sans visa ; les écritures sur le clic du cabinet ; ce qu'elles comptent, et quand.
    expect(CE_QUE_COMPTENT_SES_FACTURES).toContain('celles que le client valide comptent dans la 2035, la CA3 et les états du '
      + 'dossier dès leur encaissement')
    expect(CE_QUE_COMPTENT_SES_FACTURES).toContain('sans que tu les vises')
    expect(CE_QUE_COMPTENT_SES_FACTURES).toContain('leurs écritures s’écrivent sur ton clic, dans l’onglet Écritures.')
  })

  it('la phrase de l’onglet dit le réglage AVANT ce qui vient ensuite, et ne change rien d’autre ; sans les ventes, rien', () => {
    const fin = ' La connexion de sa banque depuis son espace viendra ensuite.'
    const phrases = LES_TROIS_REGLAGES.map((r) => ceQueDisentLesCases(true, true, true, true, true, true, true, true, true, r, false, false))
    const avantLeReglage = phrases[0].slice(0, phrases[0].length - fin.length - phraseDuReglage(BASCULE).length - 1)
    LES_TROIS_REGLAGES.forEach((reglage, i) => {
      expect(phrases[i]).toBe(`${avantLeReglage} ${phraseDuReglage(reglage)}${fin}`)
    })
    expect(new Set(phrases).size).toBe(3)
    for (const banque of [false, true]) {
      const sansVentes = LES_TROIS_REGLAGES.map((r) => ceQueDisentLesCases(banque, false, true, true, true, true, true, true, true, r, false, false))
      expect(new Set(sansVentes).size, `banque ${banque}`).toBe(1)
      expect(sansVentes[0]).not.toMatch(/source de leurs ventes|ne se lit pas/)
    }
  })

  it('ce que la phrase et le refus redisent de la base : la colonne, le chef du cabinet, et la garde de « Ventes » (VF8f)', () => {
    // La colonne : booléenne, non nulle, fausse par défaut — « illisible » ne vient que d'une ligne qu'on n'a pas lue.
    expect(fichiersDuSchema().some((f) => f.texte.includes(
      'alter table public.dossiers add column ventes_par_les_factures boolean not null default false;'))).toBe(true)
    // « Un réglage que le chef du cabinet posera » : la garde du réglage (VF8a, VF8-Q1) le réserve au chef depuis une session.
    expect(derniereDefinitionSql('garder_ventes_par_les_factures'))
      .toContain('if auth.uid() is not null and not public.est_chef_du_cabinet(old.cabinet_id) then')
    // Le resserrement (VF8f) : la base refuse « Ventes » qui arrive sur un dossier non basculé, par une garde que
    // `changer_droits_acces` ne connaît pas — la fonction ne lit toujours pas le réglage. Le refus du module est le sien, à
    // la lettre ; ventesSurDossierBascule.test.ts confronte le reste (la garde, son déclencheur, ses essais).
    expect(derniereDefinitionSql('changer_droits_acces')).not.toMatch(/ventes_par_les_factures/)
    const garde = derniereDefinitionSql('garder_droit_ventes')
    expect(garde).toContain(`raise exception '${REFUS_VENTES_DOSSIER_NON_BASCULE.message.replace(/'/g, "''")}'`)
    expect(garde).toContain(`using errcode = '${REFUS_VENTES_DOSSIER_NON_BASCULE.code}';`)
    expect(garde).toContain('from public.dossiers d where d.id = new.dossier_id for share;')
  })

  it('la phrase suit le geste que la carte de la bascule offre, pas son existence : les deux états du drapeau', () => {
    // La carte est dans l'onglet Informations, et c'est ce drapeau qui y retient le geste.
    const informations = readFileSync(resolve(process.cwd(), 'src/pages/dossier/InformationsTab.tsx'), 'utf8')
    expect(informations).toContain('<SourceDesVentesCard dossierId={dossierId}')
    const carte = readFileSync(resolve(process.cwd(), 'src/pages/dossier/SourceDesVentesCard.tsx'), 'utf8')
    expect(carte).toContain('offerte: BASCULE_OFFERTE')
    try {
      for (const offerte of [false, true]) {
        drapeau.offerte = offerte
        const raison = raisonDuDossierNonBascule(offerte)
        expect(phraseDuReglage(NON_BASCULE), `offerte ${offerte}`).toBe(raison)
        expect(gesteDeLaCase('ventes', NON_BASCULE, EXONERE), `offerte ${offerte}`).toEqual({ cocher: false, decocher: true, raison })
        // Le refus, lui, est celui de la base : il ne suit pas le drapeau (étape VF8f).
        expect(refusDeLaCase('ventes', true, NON_BASCULE, EXONERE), `offerte ${offerte}`).toBe(REFUS_VENTES_DOSSIER_NON_BASCULE.message)
        expect(raison.includes('ne s’offre pas encore'), `offerte ${offerte}`).toBe(!offerte)
        expect(raison.includes('(onglet Informations)'), `offerte ${offerte}`).toBe(offerte)
        // Ni le dossier basculé, ni le réglage illisible ne regardent le drapeau.
        expect(phraseDuReglage(BASCULE)).toBe(CE_QUE_COMPTENT_SES_FACTURES)
        expect(gesteDeLaCase('ventes', ILLISIBLE, EXONERE).raison).toBe(raisonDuReglageIllisible('lecture refusée'))
      }
    } finally {
      drapeau.offerte = null
    }
  })
})

// ── LA CASE « CAISSE » (ligne 26.6, étape C11) ───────────────────────────────────────────────────────────────────────────
// La conception reprise, § 3 à 6 ; la base : la migration `caisse_du_client` (C10), en base et dans l'export depuis le
// 02/11/2026. Ce qui se garde ici : la case lit le statut de TVA et lui seul ; ses refus sont les mots de la base ; ce que
// sa phrase dit ouvert, l'export l'ouvre au client « Caisse » ; ce qu'elle ouvre ne porte aucun texte libre du cabinet.
describe('la case « Caisse » et le statut de TVA du dossier (étape C11)', () => {
  const REDEVABLE: EtatCaisseDuDossier = { etat: 'tenue_par_le_cabinet', statut: 'redevable' }
  const A_PRECISER: EtatCaisseDuDossier = { etat: 'tenue_par_le_cabinet', statut: null }
  const FRANCHISE: EtatCaisseDuDossier = { etat: 'exclu', statut: 'franchise' }
  const STATUT_ILLISIBLE: EtatCaisseDuDossier = { etat: 'illisible', motif: 'lecture refusée' }
  // C11-Q2 : le mode comptable, lu avec le statut.
  const EN_ENGAGEMENT: EtatCaisseDuDossier = { etat: 'en_engagement', statut: 'exonere' }
  const MODE_ILLISIBLE: EtatCaisseDuDossier = { etat: 'mode_illisible', motif: 'le mode comptable n’est pas lisible' }
  const NON_BASCULE_: ReglageDuDossier = { etat: 'non_bascule' }
  const REGLAGE_ILLISIBLE: ReglageDuDossier = { etat: 'illisible', motif: 'lecture refusée' }
  const LES_DEUX = { cocher: true, decocher: true, raison: null }

  it('seuls « exonere » et « franchise » ouvrent la case ; nul est « à préciser » ; une ligne ou une colonne absente est illisible', () => {
    const tresorerie = { mode_comptable: 'tresorerie' }
    expect(etatCaisseDuDossier({ statut_tva: 'exonere', ...tresorerie })).toEqual(EXONERE)
    expect(etatCaisseDuDossier({ statut_tva: 'franchise', ...tresorerie })).toEqual(FRANCHISE)
    expect(etatCaisseDuDossier({ statut_tva: 'redevable', ...tresorerie })).toEqual(REDEVABLE)
    expect(etatCaisseDuDossier({ statut_tva: null, ...tresorerie })).toEqual(A_PRECISER)
    expect(etatCaisseDuDossier({})).toEqual({ etat: 'illisible', motif: 'le statut de TVA n’a pas été lu' })
    expect(etatCaisseDuDossier(null)).toEqual({ etat: 'illisible', motif: 'le dossier n’a pas été trouvé' })
    for (const valeur of [undefined, 'EXONERE', 'exonéré', 1, true, {}]) {
      expect(etatCaisseDuDossier({ statut_tva: valeur }), String(valeur)).toEqual({ etat: 'illisible', motif: 'le statut de TVA n’est pas lisible' })
    }
    // Les statuts exclus sont ceux que la base nomme : le module de la caisse, `garder_droit_caisse` et la garde du statut.
    expect(STATUTS_DE_LA_SAISIE_DU_CLIENT).toEqual(['exonere', 'franchise'])
    expect(derniereDefinitionSql('garder_droit_caisse'))
      .toContain("if v_statut is distinct from 'exonere' and v_statut is distinct from 'franchise' then")
    expect(derniereDefinitionSql('garder_statut_tva_de_la_caisse'))
      .toContain("if old.statut_tva is distinct from 'exonere' and old.statut_tva is distinct from 'franchise' then")
  })

  // C11-Q2 (le 04/11/2026, « La refuser à l'écran ») : un dossier exonéré ou en franchise tenu en engagement ne s'ouvre pas ;
  // un mode qu'on n'a pas lu, ou d'une autre valeur, n'est jamais « trésorerie » ; le statut se juge d'abord.
  it('le mode comptable, lu avec le statut : l’engagement ferme la case, un mode illisible n’est jamais « trésorerie »', () => {
    expect(etatCaisseDuDossier({ statut_tva: 'exonere', mode_comptable: 'engagement' })).toEqual(EN_ENGAGEMENT)
    expect(etatCaisseDuDossier({ statut_tva: 'franchise', mode_comptable: 'engagement' })).toEqual({ etat: 'en_engagement', statut: 'franchise' })
    // Redevable ou à préciser : le refus de la base, quel que soit le mode.
    expect(etatCaisseDuDossier({ statut_tva: 'redevable', mode_comptable: 'engagement' })).toEqual(REDEVABLE)
    expect(etatCaisseDuDossier({ statut_tva: null, mode_comptable: 'engagement' })).toEqual(A_PRECISER)
    for (const statut of ['exonere', 'franchise', 'redevable', null]) {
      expect(etatCaisseDuDossier({ statut_tva: statut }), String(statut)).toEqual({ etat: 'mode_illisible', motif: 'le mode comptable n’a pas été lu' })
      for (const mode of [null, undefined, 'TRESORERIE', 'trésorerie', 1, true, {}]) {
        expect(etatCaisseDuDossier({ statut_tva: statut, mode_comptable: mode }), `${statut} ${String(mode)}`).toEqual(MODE_ILLISIBLE)
      }
    }
    // Un statut illisible le reste, quel que soit le mode.
    expect(etatCaisseDuDossier({ statut_tva: 'autre', mode_comptable: 'engagement' })).toEqual({ etat: 'illisible', motif: 'le statut de TVA n’est pas lisible' })
    // Les deux modes sont ceux de la contrainte de la table, et la raison cite le refus de la base à la lettre.
    expect(fichiersDuSchema().map((f) => f.texte).join('\n'))
      .toContain("add constraint dossiers_mode_comptable_check check (mode_comptable in ('tresorerie', 'engagement'))")
    expect(RAISON_DU_DOSSIER_EN_ENGAGEMENT).toContain(`« ${MOTS_DE_LA_CAISSE.tresorerie.gabarit} »`)
    expect(messagesSql(derniereDefinitionSql('enregistrer_operation_caisse'))).toContain(MOTS_DE_LA_CAISSE.tresorerie.gabarit)
    // En une phrase : un seul point final, hors de la citation.
    expect(RAISON_DU_DOSSIER_EN_ENGAGEMENT.replace(MOTS_DE_LA_CAISSE.tresorerie.gabarit, '').match(/\./g)).toHaveLength(1)
  })

  // LA TABLE DE VÉRITÉ : chaque case lit SON état, et lui seul. « Banque » a toujours ses deux gestes ; « Ventes » suit le
  // réglage quel que soit le statut ; « Caisse » suit le statut quel que soit le réglage.
  it('la table de vérité des trois cases : trois réglages × sept états du statut et du mode', () => {
    const reglages = [BASCULE, NON_BASCULE_, REGLAGE_ILLISIBLE]
    const statuts = [EXONERE, FRANCHISE, REDEVABLE, A_PRECISER, STATUT_ILLISIBLE, EN_ENGAGEMENT, MODE_ILLISIBLE]
    for (const reglage of reglages) {
      for (const caisse of statuts) {
        const cas = `${reglage.etat} × ${caisse.etat}${'statut' in caisse ? ` ${caisse.statut}` : ''}`
        expect(gesteDeLaCase('banque', reglage, caisse), `banque ${cas}`).toEqual(LES_DEUX)
        expect(gesteDeLaCase('ventes', reglage, caisse), `ventes ${cas}`).toEqual(gesteDeLaCase('ventes', reglage, EXONERE))
        expect(gesteDeLaCase('caisse', reglage, caisse), `caisse ${cas}`).toEqual(gesteDeLaCase('caisse', BASCULE, caisse))
      }
    }
    expect(gesteDeLaCase('caisse', BASCULE, EXONERE)).toEqual(LES_DEUX)
    expect(gesteDeLaCase('caisse', BASCULE, FRANCHISE)).toEqual(LES_DEUX)
    expect(gesteDeLaCase('caisse', BASCULE, REDEVABLE)).toEqual({ cocher: false, decocher: true, raison: raisonDuDossierNonExclu('redevable') })
    expect(gesteDeLaCase('caisse', BASCULE, A_PRECISER)).toEqual({ cocher: false, decocher: true, raison: raisonDuDossierNonExclu(null) })
    expect(gesteDeLaCase('caisse', BASCULE, STATUT_ILLISIBLE))
      .toEqual({ cocher: false, decocher: false, raison: raisonDuStatutIllisible('lecture refusée') })
    // C11-Q2 : en engagement, décocher seulement ; un mode illisible, aucun geste.
    expect(gesteDeLaCase('caisse', BASCULE, EN_ENGAGEMENT)).toEqual({ cocher: false, decocher: true, raison: RAISON_DU_DOSSIER_EN_ENGAGEMENT })
    expect(gesteDeLaCase('caisse', BASCULE, { etat: 'en_engagement', statut: 'franchise' }))
      .toEqual({ cocher: false, decocher: true, raison: RAISON_DU_DOSSIER_EN_ENGAGEMENT })
    expect(gesteDeLaCase('caisse', BASCULE, MODE_ILLISIBLE))
      .toEqual({ cocher: false, decocher: false, raison: raisonDuModeIllisible('le mode comptable n’est pas lisible') })
    // La case « Caisse » d'un dossier exclu se coche même sur un réglage des ventes illisible : elle ne le lit pas.
    expect(gesteDeLaCase('caisse', REGLAGE_ILLISIBLE, EXONERE)).toEqual(LES_DEUX)
    expect(gesteDeLaCase('ventes', BASCULE, STATUT_ILLISIBLE)).toEqual(LES_DEUX)
  })

  it('cocher « Caisse » sur un dossier redevable ou à préciser se refuse aux mots de la base ; décocher passe ; illisible, ni l’un ni l’autre', () => {
    for (const caisse of [REDEVABLE, A_PRECISER]) {
      expect(refusDeLaCase('caisse', true, BASCULE, caisse)).toBe(REFUS_CAISSE_DOSSIER_NON_EXCLU.message)
      expect(refusDeLaCase('caisse', false, BASCULE, caisse)).toBeNull()
    }
    for (const caisse of [EXONERE, FRANCHISE]) {
      expect(refusDeLaCase('caisse', true, NON_BASCULE_, caisse)).toBeNull()
      expect(refusDeLaCase('caisse', false, REGLAGE_ILLISIBLE, caisse)).toBeNull()
    }
    expect(refusDeLaCase('caisse', true, BASCULE, STATUT_ILLISIBLE)).toBe(raisonDuStatutIllisible('lecture refusée'))
    expect(refusDeLaCase('caisse', false, BASCULE, STATUT_ILLISIBLE)).toBe(raisonDuStatutIllisible('lecture refusée'))
    // C11-Q2 : cocher en engagement se refuse sous la phrase de l'écran (la base l'accepterait : ce n'est pas son refus) ;
    // décocher passe ; un mode illisible, ni l'un ni l'autre.
    expect(refusDeLaCase('caisse', true, BASCULE, EN_ENGAGEMENT)).toBe(RAISON_DU_DOSSIER_EN_ENGAGEMENT)
    expect(refusDeLaCase('caisse', true, BASCULE, EN_ENGAGEMENT)).not.toBe(REFUS_CAISSE_DOSSIER_NON_EXCLU.message)
    expect(refusDeLaCase('caisse', false, BASCULE, EN_ENGAGEMENT)).toBeNull()
    expect(refusDeLaCase('caisse', true, BASCULE, MODE_ILLISIBLE)).toBe(raisonDuModeIllisible('le mode comptable n’est pas lisible'))
    expect(refusDeLaCase('caisse', false, BASCULE, MODE_ILLISIBLE)).toBe(raisonDuModeIllisible('le mode comptable n’est pas lisible'))
    expect(refusDeLaCase('banque', true, BASCULE, EN_ENGAGEMENT)).toBeNull()
    // Et la case « Ventes » garde ses mots à elle, même sur un statut qui ferme « Caisse ».
    expect(refusDeLaCase('ventes', true, NON_BASCULE_, REDEVABLE)).toBe(REFUS_VENTES_DOSSIER_NON_BASCULE.message)
    expect(refusDeLaCase('banque', true, REGLAGE_ILLISIBLE, STATUT_ILLISIBLE)).toBeNull()
  })

  // C11-Q1 (le 04/11/2026, « Oui, avec C12 ») : l'onglet TVA dit avant le clic ce que la case retient du statut — les mots de
  // `garder_statut_tva_de_la_caisse` quand un accès lu en entier la porte ; rien promis quand les accès ne sont pas lus en entier.
  it('l’avis de l’onglet TVA : seul ce qui QUITTE l’exonération et la franchise sous une case se refuse, aux mots de la base', () => {
    const avec = { etat: 'lus', avecLaCase: 1 } as const
    const sans = { etat: 'lus', avecLaCase: 0 } as const
    const partiels = { etat: 'illisibles', motif: 'délai dépassé' } as const
    const statuts = ['exonere', 'franchise', 'redevable', null] as const
    for (const actuel of statuts) {
      for (const choix of statuts) {
        const quitte = (actuel === 'exonere' || actuel === 'franchise') && choix !== 'exonere' && choix !== 'franchise'
        const cas = `${actuel} → ${choix}`
        expect(avisDuStatutSousLaCase(actuel, choix, avec), cas)
          .toEqual(quitte ? { etat: 'refuse', message: REFUS_STATUT_SOUS_LA_CASE_CAISSE.message } : null)
        expect(avisDuStatutSousLaCase(actuel, choix, sans), cas).toBeNull()
        expect(avisDuStatutSousLaCase(actuel, choix, partiels)?.etat ?? null, cas).toBe(quitte ? 'incertain' : null)
        expect(avisDuStatutSousLaCase(actuel, choix, null)?.etat ?? null, cas).toBe(quitte ? 'incertain' : null)
      }
    }
    // Plusieurs accès qui la portent : le même refus.
    expect(avisDuStatutSousLaCase('franchise', 'redevable', { etat: 'lus', avecLaCase: 3 })?.message).toBe(REFUS_STATUT_SOUS_LA_CASE_CAISSE.message)
    // Incertain : le motif dit, et aucune promesse que le changement passera.
    const incertain = avisDuStatutSousLaCase('exonere', 'redevable', partiels)!.message
    expect(incertain).toBe('Les accès du dossier n’ont pas pu être lus en entier (délai dépassé) : si l’un d’eux porte la case '
      + '« Caisse », la base refusera ce changement de statut, et il faudra la décocher d’abord, dans l’onglet Accès.')
    expect(avisDuStatutSousLaCase('exonere', 'redevable', null)!.message).toMatch(/^Les accès du dossier ne sont pas encore lus : si l’un d’eux/)
    for (const m of [incertain, avisDuStatutSousLaCase('exonere', 'redevable', null)!.message]) expect(m).not.toMatch(/passera|aucun accès/)
    // Ce que la garde juge, relu dans l'export : ce qui QUITTE l'ensemble, une case portée par un accès quelconque.
    const garde = derniereDefinitionSql('garder_statut_tva_de_la_caisse')
    expect(garde).toContain("if old.statut_tva is distinct from 'exonere' and old.statut_tva is distinct from 'franchise' then")
    expect(garde).toContain("if new.statut_tva is not distinct from 'exonere' or new.statut_tva is not distinct from 'franchise' then")
    expect(garde).toContain('if exists (select 1 from public.memberships m where m.dossier_id = old.id and m.droit_caisse) then')
  })

  it('les deux refus que le module redit sont ceux des gardes de l’export, à la lettre et au code', () => {
    expect(messagesSql(derniereDefinitionSql('garder_droit_caisse'))).toEqual([REFUS_CAISSE_DOSSIER_NON_EXCLU.message])
    expect(codesSql(derniereDefinitionSql('garder_droit_caisse'))).toEqual([REFUS_CAISSE_DOSSIER_NON_EXCLU.code])
    expect(messagesSql(derniereDefinitionSql('garder_statut_tva_de_la_caisse'))).toEqual([REFUS_STATUT_SOUS_LA_CASE_CAISSE.message])
    expect(codesSql(derniereDefinitionSql('garder_statut_tva_de_la_caisse'))).toEqual([REFUS_STATUT_SOUS_LA_CASE_CAISSE.code])
    // La garde de la case juge ce qui ARRIVE, pour tout auteur, la restauration exceptée : l'écran ne la recopie pas, il la dit.
    const garde = derniereDefinitionSql('garder_droit_caisse')
    expect(garde).toContain("if tg_op = 'INSERT' and public.is_super_admin() then")
    expect(garde).toContain('from public.dossiers d where d.id = new.dossier_id for share;')
  })

  it('la phrase de la case dit ce que la base ouvre, puis ce qu’elle devient sur CE dossier — trois statuts, trois phrases', () => {
    const debut = '« Caisse » (recettes en espèces, apports, prélèvements, pièces payées en espèces) : une case cochée ouvre au client, '
      + 'par la base, la caisse de son dossier — '
    const phrases = [EXONERE, FRANCHISE, REDEVABLE, A_PRECISER, STATUT_ILLISIBLE, EN_ENGAGEMENT, MODE_ILLISIBLE]
      .map((c) => ceQueDitLaCaseCaisse(c))
    expect(new Set(phrases).size).toBe(7)
    for (const [i, phrase] of phrases.entries()) {
      expect(phrase.startsWith(debut), String(i)).toBe(true)
      expect(phrase).toContain(CE_QUE_LA_CASE_CAISSE_OUVRE)
      expect(phrase).toContain(`${CE_QUE_LA_CASE_CAISSE_OUVRE} ${ceQueMontreMaCaisseSelon(CORRECTION_DU_PAIEMENT_EXPORTEE)} `)
      // Jamais une affirmation que la case ne change rien : la base l'ouvre dès qu'elle est cochée.
      expect(phrase).not.toMatch(/ne change (rien|pas)/)
    }
    expect(phrases[0]).toContain('Ce dossier est exonéré de TVA : la case se coche, sur ta déclaration que toutes ses opérations le sont.')
    expect(phrases[0]).toContain(CE_QUE_LA_CASE_RETIENT)
    expect(phrases[1]).toContain('Ce dossier est en franchise en base de TVA : la case se coche')
    expect(phrases[2]).toContain('sur ce dossier redevable de la TVA')
    expect(phrases[2]).toContain('CGI, art. 286, I, 3° bis')
    expect(phrases[3]).toContain('sur ce dossier dont le statut de TVA est à préciser')
    expect(phrases[4]).toContain('Le statut de TVA de ce dossier ne se lit pas (lecture refusée)')
    expect(phrases[5].endsWith(RAISON_DU_DOSSIER_EN_ENGAGEMENT)).toBe(true)
    expect(phrases[6]).toContain('Le mode comptable de ce dossier ne se lit pas (le mode comptable n’est pas lisible)')
    expect(phraseDuStatutDeLaCaisse(REDEVABLE)).toBe(raisonDuDossierNonExclu('redevable'))
    // Ce que la case retient, aux faits de la garde du statut : passer de l'un à l'autre reste possible.
    expect(CE_QUE_LA_CASE_RETIENT).toContain('passer de l’une à l’autre reste possible')
    expect(derniereDefinitionSql('garder_statut_tva_de_la_caisse'))
      .toContain("if new.statut_tva is not distinct from 'exonere' or new.statut_tva is not distinct from 'franchise' then")
  })

  it('ce que la phrase dit ouvert au client « Caisse », l’export l’ouvre à la case', () => {
    const tout = fichiersDuSchema().map((f) => f.texte).join('\n')
    // « il y lit toute la caisse de son dossier — chaque opération, celles que tu saisis et les retirées comprises » : la policy
    // de lecture, sur le mot « caisse », sans condition sur l'origine ni le retrait.
    expect(tout).toMatch(/create policy operations_caisse_lecture_caisse on public\.operations_caisse\s+for select to authenticated\s+using \(public\.client_du_dossier\(dossier_id, 'caisse'\)\);/)
    // « et sa caisse jour par jour … en totaux du jour et sans libellé (même sans « Banque » ni « Ventes »), et le solde » :
    // `caisse_du_client`, ouverte à `authenticated`, l'accès jugé par `gere_la_caisse` seul, avant toute lecture.
    const lecture = derniereDefinitionSql('caisse_du_client')
    expect(lecture).toMatch(/returns table \(jour date, report numeric, ouverture numeric, operations numeric, releve numeric,\s+especes_des_factures numeric, encaissements_du_jour uuid\[\], solde numeric, fige boolean\)/)
    const corps = lecture.slice(lecture.indexOf('begin'))
    expect(corps.indexOf('public.gere_la_caisse(p_dossier_id)')).toBeGreaterThan(0)
    expect(corps.indexOf('public.gere_la_caisse(p_dossier_id)')).toBeLessThan(corps.indexOf('v_caisse := public.compte_du_role'))
    expect(corps.indexOf('v_caisse := public.compte_du_role')).toBeLessThan(corps.indexOf('return query'))
    expect(lecture).not.toMatch(/gere_la_banque|gere_les_ventes/)
    expect(tout).toContain('grant execute on function public.caisse_du_client(uuid, integer) to authenticated;')
    expect(derniereDefinitionSql('gere_la_caisse')).toContain("public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'caisse')")
    // « Il y saisit ses recettes …, ses apports, ses prélèvements et le paiement en espèces d'une pièce, et ne retire ou ne
    // remplace que ce qu'il a saisi » : les cinq fonctions passent par `qui_ecrit_la_caisse`, qui dit « client » à la case,
    // sur un dossier exclu ; chacune est ouverte à `authenticated`.
    for (const [fonction, signature] of [
      ['enregistrer_operation_caisse', 'uuid, text, date, numeric, uuid, numeric, uuid[], jsonb'],
      ['enregistrer_operations_de_caisse', 'uuid, jsonb'],
      ['retirer_operation_caisse', 'uuid, uuid'],
      ['remplacer_operation_caisse', 'uuid, uuid, text, date, numeric, uuid, numeric, uuid[], jsonb'],
      ['regler_piece_par_la_caisse', 'uuid, uuid, date, numeric'],
    ] as const) {
      expect(derniereDefinitionSql(fonction), fonction).toContain('public.qui_ecrit_la_caisse(p_dossier_id)')
      expect(tout, fonction).toContain(`grant execute on function public.${fonction}(${signature}) to authenticated;`)
    }
    const qui = derniereDefinitionSql('qui_ecrit_la_caisse')
    expect(qui).toContain("if p_dossier_id is not null and public.client_du_dossier(p_dossier_id, 'caisse') then")
    expect(qui).toContain("if v_statut in ('exonere', 'franchise') then\n      return 'client';")
    // « ne retire ou ne remplace que ce qu'il a saisi » : l'origine et l'auteur, dans le retrait et le remplacement.
    for (const fonction of ['retirer_operation_caisse', 'remplacer_operation_caisse']) {
      expect(derniereDefinitionSql(fonction), fonction).toContain("v_origine = 'client'")
    }
    // Et, le jour où la migration de C12B-Q1 est dans l'export, la correction d'un paiement : la sixième fonction, son accès,
    // son droit, et ses propres paiements seulement (« corrige ou retire ce paiement »).
    if (CORRECTION_DU_PAIEMENT_EXPORTEE) {
      const correction = derniereDefinitionSql('remplacer_paiement_par_la_caisse')
      expect(correction).toContain('public.qui_ecrit_la_caisse(p_dossier_id)')
      expect(correction).toContain("v_origine = 'client' and v_ancien.origine = 'cabinet'")
      expect(correction).toContain("v_origine = 'client' and v_ancien.cree_par is distinct from auth.uid()")
      expect(tout).toContain('grant execute on function public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric) to authenticated;')
    }
    // « sous la nature que tu fixes » : la recette du client prend celle du dossier.
    expect(derniereDefinitionSql('enregistrer_operation_caisse')).toContain('categorie_recettes_client')
  })

  it('« Ma caisse » (étape C12a) et le paiement d’une pièce dans « Mes pièces » (étape C12b) : la phrase et la confirmation les nomment', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).toMatch(/<Route path="\/ma-caisse" element={<ClientCaisse \/>} \/>/)
    expect(readdirSync(resolve(process.cwd(), 'src/pages')).filter((f) => /^ClientCaisse\.tsx$/.test(f))).toEqual(['ClientCaisse.tsx'])
    expect(CE_QUE_MONTRE_MA_CAISSE).toContain('« Ma caisse »')
    expect(CE_QUE_MONTRE_MA_CAISSE).toContain('dans « Mes pièces », il dit qu’une pièce est payée en espèces de sa caisse')
    expect(CE_QUE_MONTRE_MA_CAISSE).toContain('l’écran ne lui montre pas le montant de la pièce')
    expect(CE_QUE_MONTRE_MA_CAISSE).not.toContain('pas encore son écran')
    expect(confirmationDeLaCaseCaisse('x', 'exonere', { etat: 'absente' }).paragraphes)
      .toContain(ceQueMontreMaCaisseSelon(CORRECTION_DU_PAIEMENT_EXPORTEE))
    // C12B-Q1 : la correction d'un paiement, dite le jour où sa migration est en base — et seulement ce jour-là.
    expect(ceQueMontreMaCaisseSelon(false)).toBe(CE_QUE_MONTRE_MA_CAISSE)
    expect(ceQueMontreMaCaisseSelon(true)).toContain('et corrige ou retire ce paiement — l’écran ne lui montre pas le montant de la pièce.')
    expect(ceQueMontreMaCaisseSelon(true).replace('corrige ou retire ce paiement', 'retire ce paiement')).toBe(CE_QUE_MONTRE_MA_CAISSE)
    // La phrase dit vrai : « Mes pièces » monte le paiement, et appelle — sous SON verrou (C12b, relecture du 03/11/2026) — la
    // fonction de la base qui le règle et celle qui le retire ; le formulaire, lui, n'appelle rien.
    const pieces = readFileSync(resolve(process.cwd(), 'src/pages/ClientUpload.tsx'), 'utf8')
    expect(pieces).toMatch(/<PaiementParMaCaisse\b/)
    expect(pieces).toContain("supabase.rpc('regler_piece_par_la_caisse'")
    expect(pieces).toContain("supabase.rpc('retirer_operation_caisse'")
    // … et, la migration de C12B-Q1 en base, celle qui le corrige : « Mes pièces » l'appelle sous le même verrou.
    expect(pieces).toContain("supabase.rpc('remplacer_paiement_par_la_caisse'")
    // « il saisit ses recettes, ses apports et ses prélèvements » : un jour, ou un mois d'un coup (C12A-Q1), par les fonctions
    // de la base qui les écrivent.
    const maCaisse = readFileSync(resolve(process.cwd(), 'src/pages/ClientCaisse.tsx'), 'utf8')
    expect(maCaisse).toContain("supabase.rpc('enregistrer_operation_caisse'")
    expect(maCaisse).toContain("supabase.rpc('enregistrer_operations_de_caisse'")
    const paiement = readFileSync(resolve(process.cwd(), 'src/pages/PaiementParMaCaisse.tsx'), 'utf8')
    expect(paiement).not.toContain('supabase')
  })

  it('ce que la case ouvre ne porte aucun texte libre du cabinet : aucun libellé neuf à écrire', () => {
    expect(TABLES_LUES_AVEC_CAISSE).toEqual(['operations_caisse'])
    const tout = fichiersDuSchema().map((f) => f.texte).join('\n')
    // La table : ses colonnes de texte sont deux listes fermées que la base vérifie ; aucune autre colonne ne s'y ajoute.
    const table = /create table public\.operations_caisse \(([\s\S]*?)\n\);/.exec(tout)?.[1] ?? ''
    const colonnes = table.split('\n').map((l) => l.trim()).filter((l) => /^[a-z_]+ /.test(l) && !l.startsWith('constraint'))
    const texte = colonnes.filter((l) => / text\b/.test(l)).map((l) => l.split(' ')[0])
    expect(texte).toEqual(['genre', 'origine'])
    expect(table).toContain("constraint operations_caisse_genre check (genre in ('recette', 'apport', 'prelevement', 'paiement'))")
    expect(table).toContain("constraint operations_caisse_origine check (origine in ('cabinet', 'client'))")
    expect(tout).not.toMatch(/alter table public\.operations_caisse\s+add column/)
    // La fonction : des jours, des montants, des identifiants et un booléen, jamais un texte.
    const rendu = /returns table \(([^)]*)\)/.exec(derniereDefinitionSql('caisse_du_client'))?.[1] ?? ''
    expect(rendu).not.toMatch(/\btext\b|varchar/)
    // La nature est un identifiant ; son libellé est celui d'une catégorie, que tout accès du dossier lit déjà.
    expect(derniereDefinitionSql('client_du_dossier')).toContain("when 'membre' then true")
  })

  it('les cases se nomment dans l’ordre des colonnes, en français', () => {
    expect(enumeration([])).toBe('')
    expect(enumeration(['a'])).toBe('a')
    expect(enumeration(['a', 'b'])).toBe('a et b')
    expect(enumeration(['a', 'b', 'c'])).toBe('a, b et c')
    expect(libellesDesCases()).toBe('« Ventes », « Banque » et « Caisse »')
    expect(libelleDeLaCase('caisse', 'client@exemple.fr')).toBe('Droit « Caisse » de client@exemple.fr')
    expect(messageDuRefus('caisse', 'client@exemple.fr', REFUS_CAISSE_DOSSIER_NON_EXCLU.message))
      .toBe(`Le droit « Caisse » de client@exemple.fr n’a pas été enregistré : ${REFUS_CAISSE_DOSSIER_NON_EXCLU.message}`)
  })

  it('la confirmation nomme la personne, ce que la case ouvre, la condition du statut lu, ce qu’elle retient et la nature', () => {
    const fixee = confirmationDeLaCaseCaisse('client@exemple.fr', 'exonere', { etat: 'fixee', libelle: 'Honoraires' })
    expect(fixee.titre).toBe('Ouvrir sa caisse à ce client ?')
    expect(fixee.bouton).toBe('Cocher « Caisse »')
    expect(`${fixee.personne.avant}${fixee.personne.personne}${fixee.personne.apres}`)
      .toBe('Cocher « Caisse » pour client@exemple.fr lui ouvre aussitôt, par la base, la caisse du dossier.')
    expect(fixee.paragraphes[0]).toBe(`Avec la case, ${CE_QUE_LA_CASE_CAISSE_OUVRE}`)
    expect(fixee.paragraphes[1]).toContain('Tu déclares que toutes les opérations de ce dossier sont exonérées de TVA')
    expect(fixee.paragraphes[1]).toContain('CGI, art. 286, I, 3° bis')
    expect(fixee.paragraphes).toContain(CE_QUE_LA_CASE_RETIENT)
    expect(fixee.paragraphes).toContain('Ses recettes en espèces se rangeront sous « Honoraires », la nature que tu as fixée pour ce dossier.')
    const franchise = confirmationDeLaCaseCaisse('client@exemple.fr', 'franchise', { etat: 'absente' })
    expect(franchise.paragraphes[1]).toContain('relève de la franchise en base de TVA (CGI, art. 293 B)')
    expect(franchise.paragraphes[1]).toContain('le jour où il la perd, décoche la case avant de changer son statut')
    expect(franchise.paragraphes.join(' ')).toContain('Tu n’as pas fixé la nature de ses recettes en espèces : tant qu’elle manque, la base refuse ses recettes')
    expect(confirmationDeLaCaseCaisse('x', 'exonere', { etat: 'hors_produit' }).paragraphes.join(' '))
      .toContain('n’est plus une catégorie de produit du dossier')
    expect(confirmationDeLaCaseCaisse('x', 'exonere', { etat: 'illisible' }).paragraphes.join(' ')).toContain('ne se lit pas')
    // Les refus de la nature que la confirmation annonce sont ceux de la saisie du client, en base.
    const saisie = derniereDefinitionSql('enregistrer_operation_caisse')
    expect(saisie).toContain('Ton cabinet n\'\'a pas fixé la nature de tes recettes en espèces')
    expect(saisie).toContain('n\'\'est plus une catégorie de produit de ton dossier')
  })
})

// ── La case « Comptes » (étape C4b) ─────────────────────────────────────────────────────────────────────────────────────
describe('la case « Comptes » (étape C4b), derrière sa migration', () => {
  const MIGRATION_SP = readFileSync(resolve(process.cwd(), 'supabase/preparees/20261106150000_situations_publiees.sql'), 'utf8')

  it('drapeau baissé, l’onglet garde ses trois cases et la forme à quatre ; levé, la quatrième et la forme à cinq', () => {
    expect(SITUATIONS_PUBLIEES_EXPORTEES).toBe(false)
    expect(DOMAINES.map((d) => d.domaine)).toEqual(['ventes', 'banque', 'caisse'])
    expect(domainesSelon(true).map((d) => d.domaine)).toEqual(['ventes', 'banque', 'caisse', 'comptes'])
    expect(Object.keys(demandeDeChangement('m', 'ventes', true))).toEqual(['p_membership_id', 'p_ventes', 'p_banque', 'p_caisse'])
    expect(demandeDeChangementSelon(true, 'm', 'comptes', true))
      .toEqual({ p_membership_id: 'm', p_ventes: null, p_banque: null, p_caisse: null, p_comptes: true })
    expect(demandeDeChangementSelon(true, 'm', 'ventes', false))
      .toEqual({ p_membership_id: 'm', p_ventes: false, p_banque: null, p_caisse: null, p_comptes: null })
    // Les noms des paramètres de la forme à cinq, ceux de la migration.
    const debut = MIGRATION_SP.indexOf('create function public.changer_droits_acces(')
    const entete = MIGRATION_SP.slice(debut, MIGRATION_SP.indexOf('returns public.memberships', debut))
    const parametres = [...entete.matchAll(/(p_\w+) (?:uuid|boolean)/g)].map((m) => m[1])
    expect(parametres).toEqual(Object.keys(demandeDeChangementSelon(true, 'm', 'comptes', true)))
  })

  it('la case se lit de sa colonne, seul « vrai » accorde ; ses deux gestes sont toujours offerts', () => {
    expect(droitsDeLaLigne({ droit_comptes: true }).comptes).toBe(true)
    for (const valeur of [false, null, undefined, 'true', 1]) expect(droitsDeLaLigne({ droit_comptes: valeur }).comptes).toBe(false)
    expect(changementApplique({ droit_comptes: true }, 'comptes', true)).toBe(true)
    expect(changementApplique({ droit_comptes: false }, 'comptes', true)).toBe(false)
    expect(gesteDeLaCase('comptes', { etat: 'illisible', motif: 'x' }, { etat: 'illisible', motif: 'x' }))
      .toEqual({ cocher: true, decocher: true, raison: null })
  })

  it('sa phrase dit ce que la base ouvre, aux mots du commentaire de la colonne, et nomme « Mes comptes »', () => {
    const { ouvrira, colonne } = definitionDe('comptes')
    expect(colonne).toBe('droit_comptes')
    for (const terme of ouvrira.replace('situations publiées : ', '').split(', ')) expect(MIGRATION_SP).toContain(terme)
    const phrase = ceQueDitLaCaseComptes()
    expect(phrase).toContain('« Mes comptes »')
    expect(phrase).toContain(CE_QUE_LA_CASE_COMPTES_OUVRE)
    // La policy du client « Comptes » : les publications en cours seulement.
    expect(MIGRATION_SP).toContain("using (client_du_dossier(dossier_id, 'comptes') and geste = 'publication' and situation_publiee_en_cours(id))")
    for (const t of TABLES_LUES_AVEC_COMPTES) expect(MIGRATION_SP).toContain(`create policy situations_publiees_lecture_comptes on public.${t}`)
  })
})
