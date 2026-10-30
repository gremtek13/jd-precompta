import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MOTS_DU_CABINET, REECRITURES_CLIENT, droitsVentesDeLaBase, lireLesDroitsVentes, mesVentesOuvertes, motsDuCabinet, pourLEspace,
  pourLEspaceSiTexte,
} from './espaceVentes'
import {
  LIBELLE_DESCRIPTION_ARTICLE, LIBELLE_DESCRIPTION_ARTICLE_CLIENT, LIBELLE_DESIGNATION_ARTICLE, LIBELLE_DESIGNATION_ARTICLE_CLIENT,
  LIBELLE_MOTIF_AVOIR, LIBELLE_MOTIF_AVOIR_CLIENT, LIBELLE_MOTIF_CONTRE_PASSATION, LIBELLE_MOTIF_CONTRE_PASSATION_CLIENT,
  LIBELLE_NOTE_DECLARATION, LIBELLE_NOTE_DECLARATION_CLIENT, LIBELLE_NOTES_FACTURE, LIBELLE_NOTES_FACTURE_CLIENT,
  LIBELLE_PLATEFORME_ADRESSE, LIBELLE_PLATEFORME_ADRESSE_CLIENT,
  LIBELLE_ADRESSE_CONTACT, LIBELLE_ADRESSE_CONTACT_CLIENT, LIBELLE_NOM_CONTACT, LIBELLE_NOM_CONTACT_CLIENT,
  LIBELLE_OBSERVATIONS_CONTACT, LIBELLE_OBSERVATIONS_CONTACT_CLIENT,
} from './droitsAcces'
import { REFUS_ENREGISTREMENT_CONTACT, REFUS_REPRISE_CONTACT } from './contacts'
import { manqueMentionTva, motifExoneration, refusTauxPositif } from './statutTva'
import { refusEmission } from './factureCii'
import {
  REFUS_CLASSEMENT, REFUS_CONTRE_PASSATION, REFUS_DECLARATION, REFUS_ENREGISTREMENT, REFUS_ESPECES_SUR_UN_CREDIT,
  REFUS_GARDE_FRONTIERE, REFUS_RETRAIT, obligationEncaissee,
} from './encaissementsFactures'
import { bilanDuReleve, refusDuReleve, verificationAvantDeclaration } from './statutsLus'
import { libelleCanal, libelleCourtCanal } from './transmissionsFactures'
import { REFUS_DECLARATION_ADRESSE } from './adressesReception'
import { REFUS_VALIDATION_SOURCE } from './sourceDeLaVente'
import type { ReleveStatuts } from './receptionPlateforme'
import { donnees, ligne } from '../test/facturesCii'

// L'ESPACE QUI REGARDE LES VENTES (espace client, étape P4a). Ce que ces cas gardent : chaque phrase que le module réécrit
// pour le client est bien celle que son module PRODUIT aujourd'hui — une phrase changée à la source ne se réécrirait plus,
// en silence — ; sa réécriture ne porte plus aucune forme du cabinet ; le garde des mots voit ces formes et ne voit pas
// « le client » qui désigne l'acheteur ; les cases relues à la base tombent du côté fermé.

const RELEVE: ReleveStatuts = {
  hote: 'flux.plateforme-fictive.fr', version: 'v1', depuis: null, issues: [],
  ecartes: { autre_flux: 0, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 }, en_attente: 0, en_erreur: 0,
  reportes: 0, complete: false, motif: 'le délai de la fonction', cycle_vie_depuis: null, cycle_vie_lu_le: null, erreur_reprise: null,
}

// Chaque phrase réécrite, telle que son module la produit : le texte où elle doit figurer.
const PRODUITES: Record<string, () => string> = {
  'motifExoneration, statut à préciser': () => motifExoneration(null, null).refus ?? '',
  'motifExoneration, exonéré sans article': () => motifExoneration('exonere', null).refus ?? '',
  'motifExoneration, redevable sans article': () => motifExoneration('redevable', null).refus ?? '',
  'refusTauxPositif, franchise': () => refusTauxPositif('franchise', 20) ?? '',
  'manqueMentionTva, statut à préciser': () => manqueMentionTva(null, null) ?? '',
  'manqueMentionTva, exonéré sans article': () => manqueMentionTva('exonere', null) ?? '',
  'refusEmission, règle G1.47': () => refusEmission(donnees({
    lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'franchise', numeroTva: null },
  })).join(' '),
  'obligationEncaissee, statut à préciser': () => obligationEncaissee({
    id: 'f1', statut: 'validee', type: 'facture', date_emission: '2027-10-01', type_client: 'assujetti',
    nature_operation: 'services', option_debits: false,
  }, [{ facture_id: 'f1', taux_tva: 20 }], null).raison,
  'refusDuReleve, identifiants refusés': () => refusDuReleve('Refusé.', { identifiants_refuses: true, acces_refuse: false }),
  'refusDuReleve, accès refusé': () => refusDuReleve('Refusé.', { identifiants_refuses: false, acces_refuse: true }),
  'bilanDuReleve, relevé incomplet': () => bilanDuReleve(RELEVE, new Map(), (d) => d).incomplet ?? '',
  'verificationAvantDeclaration, aucune plateforme': () => {
    const v = verificationAvantDeclaration('flux.plateforme-fictive.fr', [], null, null, (d) => d)
    return v.etat === 'refusee' ? '' : v.texte
  },
  'libelleCanal': () => libelleCanal({ canal: 'plateforme', hote: 'flux.plateforme-fictive.fr' }),
  'libelleCourtCanal': () => libelleCourtCanal({ canal: 'plateforme' }),
  // Les refus de la déclaration d'une adresse de réception (étape A6b1) : les dix-neuf messages de la base, tels que le module
  // les dit ; deux nomment « le dossier ».
  'REFUS_DECLARATION_ADRESSE': () => REFUS_DECLARATION_ADRESSE.map((r) => r.modele).join('\n'),
  // Les refus du fichier des clients (étape A4b1) : les vingt-sept messages d'`enregistrer_contact` et les six de
  // `reprendre_contact`, tels que le module les dit ; les deux de la règle des soins nomment « un dossier » et « ses patients ».
  'REFUS_ENREGISTREMENT_CONTACT, REFUS_REPRISE_CONTACT': () => [...REFUS_ENREGISTREMENT_CONTACT, ...REFUS_REPRISE_CONTACT]
    .map((r) => r.modele).join('\n'),
  // Les refus des quatre fonctions des encaissements que la fenêtre dit au client (étape VF5b), tels que le module les dit :
  // trois nomment ce que le cabinet seul fait, ou vouvoient.
  'REFUS_ENREGISTREMENT, REFUS_RETRAIT, REFUS_CONTRE_PASSATION, REFUS_DECLARATION': () => [
    ...REFUS_ENREGISTREMENT, ...REFUS_RETRAIT, ...REFUS_CONTRE_PASSATION, ...REFUS_DECLARATION,
  ].map((r) => r.modele).join('\n'),
  // Le refus du rang 7 du classement (le virement mixte, étape VF5h), que la fenêtre cite au client quand son geste
  // laisserait un mouvement inclassable : il vouvoie, et nomme ce que le cabinet seul fait.
  'REFUS_CLASSEMENT, rang 7': () => REFUS_CLASSEMENT.find((r) => r.cle === 'exemplaire_a_designer')?.modele ?? '',
  // Les refus de la validation d'une facture source que le formulaire dit au client avant le clic (étape VF8c) : deux nomment
  // « un dossier ».
  'REFUS_VALIDATION_SOURCE': () => REFUS_VALIDATION_SOURCE.map((r) => r.modele).join('\n'),
  // Les messages d'un module qui appelle le client Supabase : lus dans sa source, que ce test n'importe pas.

  'receptionPlateforme (source)': () => readFileSync(resolve(process.cwd(), 'src/lib/receptionPlateforme.ts'), 'utf8'),
  // Les refus de la fonction que la liaison du client rencontre (étape P4b) : lus dans sa source, au caractère près.
  'plateforme-agreee (source)': () => readFileSync(resolve(process.cwd(), 'supabase/functions/plateforme-agreee/index.ts'), 'utf8'),
}

describe('les réécritures du client', () => {
  it('chaque phrase réécrite est produite telle quelle par son module', () => {
    const produit = Object.values(PRODUITES).map((f) => f()).join('\n')
    for (const { de } of REECRITURES_CLIENT) expect(produit, de).toContain(de)
  })

  it('chaque texte produit, lu par le client, ne porte plus aucune forme du cabinet, et a changé', () => {
    for (const [nom, produire] of Object.entries(PRODUITES)) {
      if (nom.endsWith('(source)')) continue
      const texte = produire()
      const client = pourLEspace('client', texte)
      expect(motsDuCabinet(client), `${nom} : ${client}`).toEqual([])
      expect(client, nom).not.toBe(texte)
    }
    const message = 'La connexion à la plateforme du client n’a pas pu être lue.'
    expect(pourLEspace('client', message)).toBe('La connexion à ta plateforme n’a pas pu être lue.')
  })

  // Ce que `plateforme-agreee` répond aux gestes de la liaison que le client fait depuis l'étape P4b — relier, tester,
  // relire les statuts —, tel qu'il s'affiche une fois les morceaux de la source assemblés et les valeurs posées. Chaque
  // `de` est confronté à la source plus haut ; ces phrases-ci gardent que leur assemblage, lu par le client, est le sien.
  it.each([
    'Donnez à la plateforme un nom de 1 à 80 caractères.',
    'Une adresse change : ressaisissez le secret, qui ne part jamais vers une adresse pour laquelle il n\'a pas été saisi.',
    'L\'identifiant du cabinet chez la plateforme est vide, trop long ou porte un caractère invisible.',
    'La plateforme refuse la portée demandée : vérifiez-la, ou laissez-la vide.',
    'La plateforme ne connaît pas l\'adresse des jetons (404) : vérifiez-la.',
    'La plateforme n\'a pas répondu à temps (jeton). Réessayez dans un instant.',
    'La plateforme limite le nombre d\'appels (flux) : réessayez dans un instant.',
    'La plateforme refuse l\'accès (flux, 403) : l\'identité ouverte au cabinet n\'a pas les droits de lecture des flux de '
      + 'cette entreprise, ou l\'organisation est à préciser.',
    'La plateforme ne connaît pas cette route (flux, 404) : vérifiez l\'adresse du service des flux, qui s\'arrête avant « /v1 ».',
    'La lecture des statuts s\'est interrompue : réessayez.',
    'La transmission a changé entre-temps : rechargez la page.',
    'Cette facture a déjà une transmission en cours ou faite : suivez-la plutôt que de la renvoyer.',
  ])('« %s » : le client la lit tutoyée, sans « le cabinet » pour qui la lit', (phrase) => {
    const client = pourLEspace('client', phrase)
    expect(client).not.toBe(phrase)
    expect(motsDuCabinet(client), client).toEqual([])
    expect(client).not.toMatch(/\bau cabinet\b|\bdu cabinet\b/)
    expect(pourLEspace('cabinet', phrase)).toBe(phrase)
  })

  // Les refus des encaissements que la fenêtre dit au client (étape VF5b) : le classement d'un mouvement, c'est son cabinet
  // qui le retire ; une contre-passation, c'est lui qui la retire, tutoyé.
  it.each([
    [
      REFUS_ENREGISTREMENT.find((r) => r.cle === 'mouvement_classe')?.modele,
      "Ce mouvement est déjà classé : l'encaissement d'une facture source de sa vente ne cite qu'un mouvement que rien ne classe encore — ton cabinet retire d'abord ce classement.",
    ],
    [
      REFUS_RETRAIT.find((r) => r.cle === 'mouvement_classe')?.modele,
      "Le mouvement dont dépend cet encaissement est classé : ton cabinet retire d'abord ce classement.",
    ],
    [
      REFUS_CONTRE_PASSATION.find((r) => r.cle === 'mouvement_encaissement_classe')?.modele,
      "Le mouvement de l'encaissement contre-passé est classé par ses encaissements : la contre-passation cite le débit qui défait l'encaissement, ou ton cabinet retire d'abord ce classement.",
    ],
    [
      REFUS_RETRAIT.find((r) => r.cle === 'annule')?.modele,
      "Cet encaissement est annulé par une contre-passation : retire d'abord celle-ci.",
    ],
    // Les refus du registre pour la facture d'avant d'un virement mixte (étape VF5h2) : ce classement aussi, c'est son
    // cabinet qui le retire.
    [
      REFUS_ENREGISTREMENT.find((r) => r.cle === 'mouvement_classe_facture_d_avant')?.modele,
      "Ce mouvement est déjà classé par ses encaissements : l'encaissement d'une facture qui n'est pas la source de sa vente ne s'y ajoute plus — ton cabinet retire d'abord ce classement.",
    ],
    [
      REFUS_RETRAIT.find((r) => r.cle === 'mouvement_classe_facture_d_avant')?.modele,
      "Le mouvement dont dépend cet encaissement est classé par ses encaissements : ton cabinet retire d'abord ce classement.",
    ],
    [
      REFUS_CONTRE_PASSATION.find((r) => r.cle === 'mouvement_encaissement_classe_facture_d_avant')?.modele,
      "Le mouvement de l'encaissement contre-passé est classé par ses encaissements : ton cabinet retire d'abord ce classement.",
    ],
    // Le virement mixte (étape VF5h) : l'exemplaire d'une facture, c'est son cabinet qui le désigne.
    [
      REFUS_CLASSEMENT.find((r) => r.cle === 'exemplaire_a_designer')?.modele,
      "Ton cabinet doit d'abord désigner l'exemplaire de la facture % : ce mouvement porte aussi son encaissement, et cette facture, qui n'est pas la source de sa vente, se compte par une seule pièce validée.",
    ],
  ])('le client lit « %s » sous ses mots', (cabinet, client) => {
    expect(pourLEspace('client', cabinet ?? '')).toBe(client)
    expect(pourLEspace('cabinet', cabinet ?? '')).toBe(cabinet)
  })

  // La garde de la frontière des encaissements (étape VF7a) : ses fonctions atteignent l'un de ses refus (un mouvement figé
  // cité — supabase/essais/ventesFacturees.sql, 148b), et toutes ses phrases peuvent remonter jusqu'à lui par une erreur.
  // Elles se lisent telles quelles : ni le cabinet, ni un onglet, ni le vouvoiement — aucune réécriture n'y touche.
  it.each(REFUS_GARDE_FRONTIERE.map((r) => [r.cle, r.modele.replace('%', 'L\'exercice 2025 est validé')]))(
    'la garde de la frontière (%s) : le client la lit telle quelle', (_cle, phrase) => {
      expect(motsDuCabinet(phrase), phrase).toEqual([])
      expect(pourLEspace('client', phrase)).toBe(phrase)
    })

  // La garde des espèces (la caisse, étape C6) : la fenêtre du client « Ventes » et « Banque » dit son refus avant le clic,
  // et la base le rendrait après une écriture concurrente. Il se lit tel quel : ni le cabinet, ni un onglet, ni le vouvoiement.
  it('la garde des espèces : le client la lit telle quelle', () => {
    const phrase = REFUS_ESPECES_SUR_UN_CREDIT.modele
    expect(motsDuCabinet(phrase), phrase).toEqual([])
    expect(pourLEspace('client', phrase)).toBe(phrase)
  })

  it('le texte du cabinet reste le sien, au caractère près', () => {

    for (const produire of Object.values(PRODUITES)) {
      const texte = produire()
      expect(pourLEspace('cabinet', texte)).toBe(texte)
    }
  })

  it('chaque réécriture est tutoyée et ne nomme ni onglet ni « client » titulaire', () => {
    for (const { de, vers } of REECRITURES_CLIENT) {
      expect(motsDuCabinet(vers), vers).toEqual([])
      expect(vers).not.toBe(de)
    }
  })

  it('le statut de TVA à préciser se dit avec la phrase de la conception', () => {
    expect(pourLEspace('client', motifExoneration(null, null).refus ?? ''))
      .toBe('Ton cabinet doit d’abord préciser ton statut de TVA : tes factures ne peuvent pas partir.')
  })

  it('un texte absent reste absent', () => {
    expect(pourLEspaceSiTexte('client', null)).toBeNull()
    expect(pourLEspaceSiTexte('cabinet', null)).toBeNull()
    expect(pourLEspaceSiTexte('client', 'Refusé par la plateforme du client.')).toBe('Refusé par ta plateforme.')
  })
})

describe('le garde des mots', () => {
  it.each([
    ['Choisis-le dans l’onglet TVA du dossier.', 'un onglet'],
    ['Rouvre l’onglet Factures.', 'un onglet'],
    ['Statuts lus sur la plateforme du client', 'la plateforme du client'],
    ['Plateforme du client : Plateforme fictive', 'la plateforme du client'],
    ['par une plateforme agréée du client', 'la plateforme du client'],
    ['celle du client, reliée ailleurs', 'celle du client'],
    ['Demandez au client d’ouvrir au cabinet le droit.', 'demander au client'],
    ['demandez-en de nouveaux au client, puis', 'demander au client'],
    ['Notes (mais le client qui porte la case « Ventes » les lit)', 'le client qui porte la case'],
    ['le cabinet ou le client y saisit le statut', 'le cabinet ou le client'],
    ['Vous déclarez avoir saisi', 'le vouvoiement'],
    ['Saisissez d’abord sur la plateforme', 'le vouvoiement'],
    ['reliez-la ici', 'le vouvoiement'],
    ['ne gardez qu’une pièce', 'le vouvoiement'],
  ])('voit « %s » (%s)', (texte, forme) => {
    expect(motsDuCabinet(texte).map((m) => m.split(' : ')[0])).toContain(forme)
  })

  it.each([
    'Le SIREN du client manque ou ne passe pas sa clé de contrôle.',
    'Si elle y est et qu’elle repart, le client la recevra deux fois.',
    'un montant à rendre au client se fait par un avoir.',
    'L’adresse du client manque.',
    'Ton cabinet doit d’abord préciser ton statut de TVA.',
    'Tu déclares avoir saisi sur ta plateforme, chez toi, assez tôt.',
    'Le client est une entreprise établie en France.',
  ])('laisse « %s »', (texte) => {
    expect(motsDuCabinet(texte)).toEqual([])
  })

  it('chaque forme a un nom, et l’extrait cité porte la forme', () => {
    for (const { nom, motif } of MOTS_DU_CABINET) {
      expect(nom).not.toBe('')
      expect(motif.flags).toContain('i')
    }
    expect(motsDuCabinet('Une phrase qui renvoie à l’onglet Justificatifs du dossier.')[0]).toContain('onglet Justificatifs')
  })
})

describe('les libellés des textes que le client écrit', () => {
  it.each([
    [LIBELLE_NOTES_FACTURE, LIBELLE_NOTES_FACTURE_CLIENT],
    [LIBELLE_MOTIF_AVOIR, LIBELLE_MOTIF_AVOIR_CLIENT],
    [LIBELLE_MOTIF_CONTRE_PASSATION, LIBELLE_MOTIF_CONTRE_PASSATION_CLIENT],
    [LIBELLE_NOTE_DECLARATION, LIBELLE_NOTE_DECLARATION_CLIENT],
    [LIBELLE_DESIGNATION_ARTICLE, LIBELLE_DESIGNATION_ARTICLE_CLIENT],
    [LIBELLE_DESCRIPTION_ARTICLE, LIBELLE_DESCRIPTION_ARTICLE_CLIENT],
    [LIBELLE_PLATEFORME_ADRESSE, LIBELLE_PLATEFORME_ADRESSE_CLIENT],
    [LIBELLE_NOM_CONTACT, LIBELLE_NOM_CONTACT_CLIENT],
    [LIBELLE_ADRESSE_CONTACT, LIBELLE_ADRESSE_CONTACT_CLIENT],
    [LIBELLE_OBSERVATIONS_CONTACT, LIBELLE_OBSERVATIONS_CONTACT_CLIENT],
  ])('« %s » se dit au client : ton cabinet le lit aussi', (cabinet, client) => {
    expect(motsDuCabinet(cabinet).length).toBeGreaterThan(0)
    expect(motsDuCabinet(client)).toEqual([])
    expect(client).toMatch(/ton cabinet (les |le |la )?lit aussi/)
  })
})

describe('« Mes ventes » s’offre-t-il ?', () => {
  it('avec la case « Ventes », et seulement les ventes du client en base', () => {
    expect(mesVentesOuvertes(true, true)).toBe(true)
    expect(mesVentesOuvertes(true, false)).toBe(false)
    expect(mesVentesOuvertes(false, true)).toBe(false)
    expect(mesVentesOuvertes(false, false)).toBe(false)
  })
})

describe('les cases relues à la base', () => {
  const motif = () => 'refus lu'
  it('seul `true` accorde', () => {
    expect(droitsVentesDeLaBase({ data: { cabinet: false, membre: true, ventes: true, banque: false }, error: null }, motif))
      .toEqual({ droits: { ventes: true, banque: false }, motif: null })
    expect(droitsVentesDeLaBase({ data: { ventes: 'true', banque: 1 }, error: null }, motif))
      .toEqual({ droits: { ventes: false, banque: false }, motif: null })
    expect(droitsVentesDeLaBase({ data: {}, error: null }, motif)).toEqual({ droits: { ventes: false, banque: false }, motif: null })
  })

  it('un refus, ou une réponse d’une autre forme, ne rend aucun droit, avec son motif', () => {
    expect(droitsVentesDeLaBase({ data: { ventes: true, banque: true }, error: { message: 'x' } }, motif))
      .toEqual({ droits: null, motif: 'refus lu' })
    for (const data of [null, [], 'oui', true]) {
      expect(droitsVentesDeLaBase({ data, error: null }, motif)).toEqual({ droits: null, motif: 'droits illisibles' })
    }
  })

  it('la requête est attendue ; une requête qui lève ferme, avec son motif', async () => {
    expect(await lireLesDroitsVentes(Promise.resolve({ data: { ventes: true, banque: true }, error: null }), motif))
      .toEqual({ droits: { ventes: true, banque: true }, motif: null })
    expect(await lireLesDroitsVentes(Promise.reject(new Error('réseau coupé')), (e) => (e as Error).message))
      .toEqual({ droits: null, motif: 'réseau coupé' })
  })
})
