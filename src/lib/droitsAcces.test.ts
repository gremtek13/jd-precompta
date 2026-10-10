import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUCUN_DROIT, CE_QUE_DISENT_LES_CASES, CE_QUE_DONNE_UN_ACCES, DOMAINES, LIBELLE_MOTIF_AVOIR, LIBELLE_MOTIF_CONTRE_PASSATION,
  LIBELLE_NOTE_DECLARATION, LIBELLE_NOTES_FACTURE, ceQueDisentLesCases, ceQueDonneUnAcces, changementApplique, definitionDe,
  demandeDeChangement, droitsDeLaLigne, droitsParDossier, droitsSur, libelleDeLaCase, messageDuRefus,
} from './droitsAcces'
import { COUVERTURE_EXPORTEE } from './couvertureReleve'
import { VENTES_DU_CLIENT_EXPORTEES } from './encaissementsFactures'
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
  // DEPUIS L'ÉTAPE P7, UN SEUL ÉCRAN EN LIT UN : « Ma simulation » lit la case « Banque », et seulement derrière
  // `COUVERTURE_EXPORTEE` — ce qu'espaceClientAvantCouverture.test.tsx (drapeau faux) et
  // ClientSimulation.banque.test.tsx (vrai) éprouvent sur l'écran rendu ; la phrase de l'onglet suit le même drapeau
  // (test suivant).
  it('les écrans du client sont ceux que la phrase décrit, et seule « Ma simulation » lit un droit : « Banque », derrière le drapeau', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    const routesClient = [...app.matchAll(/<Route path="(\/[^"]+)" element=\{<(Client\w+) \/>\} \/>/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(routesClient).toEqual([
      '/accueil ClientHome', '/mes-pieces ClientUpload', '/mes-informations ClientInformations', '/ma-simulation ClientSimulation',
    ])
    const ecransClient = readdirSync(resolve(process.cwd(), 'src/pages')).filter((f) => /^Client\w+\.tsx$/.test(f) && !f.includes('.test.'))
    expect(ecransClient.sort()).toEqual(['ClientHome.tsx', 'ClientInformations.tsx', 'ClientSimulation.tsx', 'ClientUpload.tsx'])
    for (const fichier of [...ecransClient.filter((f) => f !== 'ClientSimulation.tsx').map((f) => `src/pages/${f}`), 'src/components/Layout.tsx']) {
      const texte = readFileSync(resolve(process.cwd(), fichier), 'utf8')
      expect(texte, fichier).not.toMatch(/droit_ventes|droit_banque|droitsParDossier|droitsSur\b|droitsAcces/)
    }
    const simulation = readFileSync(resolve(process.cwd(), 'src/pages/ClientSimulation.tsx'), 'utf8')
    expect(simulation).toContain('simulationOuverte(COUVERTURE_EXPORTEE, droitsSur(droitsParDossier ?? {}, dossierId).banque)')
    expect(simulation).not.toMatch(/droit_ventes|droit_banque|\.ventes\b/)
  })

  it('la phrase de l’onglet dit ce qu’un accès donne — dans les deux états du drapeau de la banque', () => {
    // Avant que la couverture du relevé soit en base : la simulation, pour tout accès.
    expect(ceQueDonneUnAcces(false)).toContain('dépose ses pièces et ses documents')
    expect(ceQueDonneUnAcces(false)).toContain('voit sa simulation')
    // Après : la simulation suit la case « Banque » (hypothèse EC-Q1).
    expect(ceQueDonneUnAcces(true)).toContain('dépose ses pièces et ses documents')
    expect(ceQueDonneUnAcces(true)).toContain('avec la case « Banque », il voit aussi sa simulation')
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
  'de proposer ou de retirer une pièce comme justificatif d’un mouvement': ['proposer_justificatif', 'retirer_proposition'],
  'd’écrire des précisions sur un mouvement': ['ecrire_precision_mouvement'],
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
    const phrase = ceQueDisentLesCases(banque, ventes)
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
    expect(suite.endsWith(' Les écrans « Ventes » et « Banque » de son espace viendront ensuite.')).toBe(true)
    // Chaque étape ouverte se dit « par la base et sans écran encore » : sa session lit et agit, aucun écran ne le montre.
    expect(suite.match(/par la base et sans écran encore/g)?.length).toBe(Number(banque) + Number(ventes))

    if (banque) {
      expect(suite).toContain('« Banque » permet déjà au client de voir sa simulation')
      expect(suite).toContain('de lire le contrôle de solde de ses relevés')
      for (const geste of Object.keys(GESTES_AVEC_BANQUE)) expect(suite).toContain(geste)
    } else {
      expect(suite).not.toMatch(/simulation|contrôle de solde|justificatif|précisions/)
    }

    if (ventes) {
      expect(suite).toContain('« Ventes » permet déjà au client, par la base et sans écran encore, de lire ses ventes')
      for (const lu of Object.keys(LU_AVEC_VENTES)) expect(suite).toContain(lu)
      for (const geste of Object.keys(GESTES_AVEC_VENTES)) expect(suite).toContain(geste)
      // Ce que le cabinet y écrit est lu aussi : les libellés de ces champs le disent (plus bas).
      expect(suite).toContain('avec ce que le cabinet y a écrit (notes et motifs)')
      // Désigner le mouvement qui prouve un encaissement demande AUSSI « Banque » — seul effet de cette case sans P7.
      expect(suite).toContain(banque
        ? 'et, avec « Ventes », de désigner celui qui prouve un encaissement.'
        : '« Banque » ne change encore qu’une chose, et seulement avec « Ventes » : le client peut désigner le mouvement '
          + 'du relevé qui prouve un encaissement.')
      expect(suite).not.toMatch(/ne change pas/)
    } else {
      expect(suite).not.toMatch(/encaissement|notes|factures/)
      expect(suite).toContain('Cocher « Ventes » ne change pas encore ce que le client voit ou fait.')
    }
  })

  it('les quatre états ont quatre phrases', () => {
    expect(new Set(ETATS.map(({ banque, ventes }) => ceQueDisentLesCases(banque, ventes))).size).toBe(4)
  })

  it('ce que l’onglet affiche est la phrase de l’état des deux drapeaux', () => {
    expect(CE_QUE_DISENT_LES_CASES).toBe(ceQueDisentLesCases(COUVERTURE_EXPORTEE, VENTES_DU_CLIENT_EXPORTEES))
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
    expect(policies.map((p) => p[1]).sort()).toEqual(Object.values(LU_AVEC_VENTES).flat().sort())
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
  ]

  it('aucun ne se dit interne ; chacun dit où le texte va, et que le client qui porte la case le lit', () => {
    for (const [libelle, ou, lit] of LIBELLES) {
      expect(libelle).not.toMatch(/intern/i)
      expect(libelle).toContain(`le client qui porte la case « ${definitionDe('ventes').libelle} »`)
      expect(libelle).toContain(ou)
      expect(libelle).toContain(lit)
    }
    expect(new Set(LIBELLES.map(([l]) => l)).size).toBe(4)
  })

  it('la phrase des cases dit lus les textes que les libellés disent lus', () => {
    for (const banque of [false, true]) {
      expect(ceQueDisentLesCases(banque, true)).toContain('avec ce que le cabinet y a écrit (notes et motifs)')
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
})
