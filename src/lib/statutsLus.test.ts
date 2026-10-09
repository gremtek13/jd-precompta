import { describe, expect, it } from 'vitest'
import { CODES_STATUT_RECU } from './cdarRecu'
import type { ReleveStatuts } from './receptionPlateforme'
import {
  auteurDuStatut, bilanDuReleve, classeStatutLu, CONSEQUENCE_ANNULATION, COLONNES_STATUT_LU, estUneAnnulation,
  horodatageTelQuEcrit, libelleStatutLu, montantsTelsQuEcrits, refusDuReleve, statutDeLaPastille, statutsDeLaFacture,
  verificationAvantDeclaration, type StatutLu,
} from './statutsLus'
import { badgeClasseStatutSuperpdp, libelleStatutSuperpdp } from './superpdpStatuts'
import { STATUTS_ANNULATION_PLATEFORME } from './transmissionsFactures'

// CE QUE LES ÉCRANS DISENT DES STATUTS LUS SUR LA PLATEFORME DU CLIENT (ligne 28.5, étape d7, phase C). Données FICTIVES.

const statut = (o: Partial<StatutLu> = {}): StatutLu => ({
  id: 's1', facture_id: 'f1', code: '205', hote: 'pa.exemple.fr', flux_id: 'flux-1', message_id: null,
  emis_le: '20261005101500', createur_role: 'BY', date_statut: '2026-10-05', motifs: null, commentaire: null, montants: [],
  lu_le: '2026-10-08T09:00:00Z', ...o,
})

const releve = (o: Partial<ReleveStatuts> = {}): ReleveStatuts => ({
  hote: 'pa.exemple.fr', version: 'v1', depuis: null, issues: [], en_attente: 0, en_erreur: 0, reportes: 0, complete: true,
  ecartes: { autre_flux: 0, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 }, motif: null,
  cycle_vie_depuis: '2026-10-09T08:00:00Z', cycle_vie_lu_le: '2026-10-09T09:00:00Z', erreur_reprise: null, ...o,
})

// Une mise en forme d'instant qui ne dépend d'aucun fuseau : le test dit ce qu'il passe.
const dateDe = (instant: string) => `[${instant}]`

describe('les libellés : ceux de la DGFiP, d’une seule table', () => {
  it('chaque code du tableau 8 a son libellé dans la table de superpdpStatuts, et rien d’autre n’est inventé', () => {
    for (const code of CODES_STATUT_RECU) {
      expect(libelleStatutLu(code), code).toBe(libelleStatutSuperpdp(`fr:${code}`))
      // Un libellé, pas le code rendu tel quel par le repli.
      expect(libelleStatutLu(code), code).not.toBe(`fr:${code}`)
      expect(classeStatutLu(code), code).toBe(badgeClasseStatutSuperpdp(`fr:${code}`))
    }
    expect(libelleStatutLu('210')).toBe('Refusée')
    expect(libelleStatutLu('213')).toBe('Rejetée')
    expect(libelleStatutLu('212')).toBe('Encaissée')
  })

  it('un refus ou un rejet en badge-danger ; les deux seuls codes qui annulent sont ceux de la base', () => {
    expect(classeStatutLu('210')).toBe('badge-danger')
    expect(classeStatutLu('213')).toBe('badge-danger')
    expect(CODES_STATUT_RECU.filter(estUneAnnulation)).toEqual([...STATUTS_ANNULATION_PLATEFORME])
    expect(estUneAnnulation('601')).toBe(false)
    expect(CONSEQUENCE_ANNULATION).toBe(
      'elle s’annule par un avoir interne, qui ne se transmet pas, puis une nouvelle facture (spécifications externes de la DGFiP, § 3.6.4)',
    )
  })

  it('les colonnes lues sont celles de la table, sans le dossier ni le lecteur', () => {
    expect(COLONNES_STATUT_LU.split(', ')).toEqual([
      'id', 'facture_id', 'code', 'hote', 'flux_id', 'message_id', 'emis_le', 'createur_role', 'date_statut', 'motifs',
      'commentaire', 'montants', 'lu_le',
    ])
  })
})

describe('ce qu’un statut dit', () => {
  it('l’auteur : les quatre rôles nommés, un autre tel quel, rien quand le message ne le dit pas', () => {
    expect(auteurDuStatut('BY')).toBe('l’acheteur')
    expect(auteurDuStatut('SE')).toBe('le vendeur')
    expect(auteurDuStatut('WK')).toBe('une plateforme')
    expect(auteurDuStatut('DFH')).toBe('l’administration')
    expect(auteurDuStatut('PE')).toBe('le rôle PE')
    expect(auteurDuStatut(null)).toBeNull()
  })

  it('l’horodatage tel qu’écrit, mis en forme sans être converti ; une autre forme telle quelle', () => {
    expect(horodatageTelQuEcrit('20261005231559')).toBe('05/10/2026 à 23:15:59 (heure de la plateforme)')
    expect(horodatageTelQuEcrit('2026100523155')).toBe('2026100523155')
    expect(horodatageTelQuEcrit('x20261005231559')).toBe('x20261005231559')
  })

  it('les montants tels qu’écrits, jamais convertis ; vide sans montant', () => {
    expect(montantsTelsQuEcrits([])).toBe('')
    expect(montantsTelsQuEcrits([
      { code: 'MEN', montant: '1200.00', devise: 'EUR', taux: '20.00', date: '2026-10-15' },
      { code: 'RAP', montant: '155.5', devise: null, taux: null, date: null },
      { code: 'XYZ', montant: '1', devise: 'USD', taux: null, date: null },
      { code: null, montant: '2', devise: null, taux: null, date: null },
    ])).toBe('encaissé 1200.00 EUR au taux 20.00 le 15/10/2026 ; reste à payer 155.5 ; XYZ 1 USD ; 2')
    expect(montantsTelsQuEcrits([{ code: 'MPA', montant: '3', devise: null, taux: null, date: null }])).toBe('payé 3')
  })
})

describe('l’ordre des statuts d’une facture, et sa pastille', () => {
  it('le plus récent lu d’abord, puis le plus tard horodaté, puis l’identifiant ; sans horodatage après', () => {
    const lus = [
      statut({ id: 'a', lu_le: '2026-10-08T09:00:00Z' }),
      statut({ id: 'b', lu_le: '2026-10-09T09:00:00Z', emis_le: '20261005080000' }),
      statut({ id: 'c', lu_le: '2026-10-09T09:00:00Z', emis_le: '20261006080000' }),
      statut({ id: 'd', lu_le: '2026-10-09T09:00:00Z', emis_le: null }),
      statut({ id: 'e', lu_le: '2026-10-09T09:00:00Z', emis_le: null }),
      statut({ id: 'z', facture_id: 'f2', lu_le: '2026-10-10T09:00:00Z' }),
    ]
    expect(statutsDeLaFacture(lus, 'f1').map((s) => s.id)).toEqual(['c', 'b', 'd', 'e', 'a'])
    expect(statutsDeLaFacture([...lus].reverse(), 'f1').map((s) => s.id)).toEqual(['c', 'b', 'd', 'e', 'a'])
    expect(statutDeLaPastille(lus, 'f1')?.id).toBe('c')
    expect(statutDeLaPastille(lus, 'f-aucune')).toBeNull()
  })

  it('le refus en tête, quoi qu’il soit venu après lui ; entre deux refus, le plus récent', () => {
    const lus = [
      statut({ id: 'r1', code: '210', lu_le: '2026-10-01T09:00:00Z' }),
      statut({ id: 'p', code: '212', lu_le: '2026-10-09T09:00:00Z' }),
      statut({ id: 'r2', code: '213', lu_le: '2026-10-02T09:00:00Z' }),
    ]
    expect(statutsDeLaFacture(lus, 'f1').map((s) => s.id)).toEqual(['r2', 'r1', 'p'])
    expect(statutDeLaPastille(lus, 'f1')?.code).toBe('213')
  })
})

describe('le bilan d’un relevé', () => {
  it('les gardés, le refus en tête, avec leur numéro et leurs données écartées ; le reste en phrases accordées', () => {
    const b = bilanDuReleve(releve({
      issues: [
        { flux: 'L1', issue: 'garde', facture_id: 'f1', code: '205', avertissements: [] },
        { flux: 'L2', issue: 'garde', facture_id: 'f2', code: '213', avertissements: ['Le rôle est illisible.'] },
        { flux: 'L3', issue: 'garde', facture_id: 'f3', code: '207', avertissements: [] },
        { flux: 'L4', issue: 'deja_lu' },
        { flux: 'L5', issue: 'ecarte', ecart: 'facture_inconnue', raison: 'Aucune facture validée du dossier ne porte ce numéro.', code: '210', detail: null },
        {
          flux: 'L6', issue: 'ecarte', ecart: 'autre_objet', raison: 'Un statut sur un statut.', code: '601',
          detail: { reference: 'MSG-1', date_objet: '2026-10-07', motifs: 'R1 : motif', commentaire: 'Commentaire.' },
        },
        {
          flux: 'L7', issue: 'ecarte', ecart: 'autre_objet', raison: 'Un autre.', code: '601',
          detail: { reference: 'MSG-2', date_objet: null, motifs: null, commentaire: null },
        },
        { flux: 'L8', issue: 'echec', raison: 'La base n’a pas répondu.', statut_http: null },
      ],
      en_attente: 1, en_erreur: 2, reportes: 3,
      ecartes: { autre_flux: 1, illisible: 2, format: 1, statut_inconnu: 2, doublons: 1 },
    }), new Map([['f1', 'F-1'], ['f2', 'F-2'], ['f3', null]]), dateDe)
    expect(b.titre).toBe('Statuts lus sur pa.exemple.fr le [2026-10-09T09:00:00Z]')
    expect(b.gardes.map((g) => [g.numero, g.code, g.libelle, g.classe, g.annulation])).toEqual([
      ['F-2', '213', 'Rejetée', 'badge-danger', true],
      ['F-1', '205', 'Approuvée', 'badge-ok', false],
      [null, '207', 'En litige', 'badge-danger', false],
    ])
    expect(b.gardes[0].avertissements).toEqual(['Le rôle est illisible.'])
    expect(b.dejaLus).toBe('1 statut déjà lu : reconnu, il ne s’écrit pas deux fois.')
    expect(b.ecartes).toEqual([
      { flux: 'L5', texte: 'Aucune facture validée du dossier ne porte ce numéro.', detail: null },
      {
        flux: 'L6', texte: 'Un statut sur un statut.',
        detail: 'La plateforme de l’administration a rejeté un statut : le message MSG-1 du 07/10/2026 ; motifs : R1 : motif ; commentaire : Commentaire.',
      },
      { flux: 'L7', texte: 'Un autre.', detail: 'La plateforme de l’administration a rejeté un statut : le message MSG-2.' },
    ])
    expect(b.echecs).toEqual([{ flux: 'L8', texte: 'La base n’a pas répondu. Le prochain relevé le reprendra.' }])
    expect(b.comptes).toEqual([
      '1 statut en attente : la plateforme n’a pas fini de le traiter, il reviendra.',
      '2 statuts en erreur chez la plateforme : ils ne se lisent pas.',
      '3 statuts prêts non lus cette fois (le temps ou le nombre) : le prochain relevé les lira.',
      '1 message écarté : ce n’est pas un statut de facture émise.',
      '2 statuts écartés : sans identifiant ou sans date de mise à jour lisible.',
      '1 statut écarté : dans un format que l’application ne lit pas.',
      '2 statuts écartés : la plateforme ne dit pas s’ils sont prêts.',
      '1 doublon écarté : un statut que la plateforme a listé deux fois.',
    ])
    expect(b.incomplet).toBeNull()
    expect(b.reprise).toBeNull()
    expect(b.rienDeNouveau).toBe(false)
  })

  it('les pluriels et les singuliers de l’autre bord', () => {
    const b = bilanDuReleve(releve({
      issues: [{ flux: 'a', issue: 'deja_lu' }, { flux: 'b', issue: 'deja_lu' }],
      en_attente: 2, en_erreur: 1, reportes: 1,
      ecartes: { autre_flux: 2, illisible: 1, format: 2, statut_inconnu: 1, doublons: 2 },
    }), new Map(), dateDe)
    expect(b.dejaLus).toBe('2 statuts déjà lus : reconnus, ils ne s’écrivent pas deux fois.')
    expect(b.comptes).toEqual([
      '2 statuts en attente : la plateforme n’a pas fini de les traiter, ils reviendront.',
      '1 statut en erreur chez la plateforme : il ne se lit pas.',
      '1 statut prêt non lu cette fois (le temps ou le nombre) : le prochain relevé le lira.',
      '2 messages écartés : ce ne sont pas des statuts de factures émises.',
      '1 statut écarté : sans identifiant ou sans date de mise à jour lisible.',
      '2 statuts écartés : dans un format que l’application ne lit pas.',
      '1 statut écarté : la plateforme ne dit pas s’il est prêt.',
      '2 doublons écartés : des statuts que la plateforme a listés plus d’une fois.',
    ])
    // Rien de gardé, d'écarté ni d'échoué : rien de nouveau, même avec des déjà-lus.
    expect(b.rienDeNouveau).toBe(true)
  })

  it('un relevé incomplet : le motif, l’invitation à relancer, et ce qu’on sait du dernier relevé allé au bout', () => {
    const avecDate = bilanDuReleve(releve({ complete: false, motif: 'le temps manquait', cycle_vie_lu_le: '2026-10-01T09:00:00Z' }), new Map(), dateDe)
    expect(avecDate.titre).toBe('Statuts lus en partie sur pa.exemple.fr — le dernier relevé allé au bout date du [2026-10-01T09:00:00Z]')
    expect(avecDate.incomplet).toBe('Relevé incomplet : le temps manquait. Relancez la lecture pour la suite.')
    const sansDate = bilanDuReleve(releve({ complete: false, motif: null, cycle_vie_lu_le: null }), new Map(), dateDe)
    expect(sansDate.titre).toBe('Statuts lus en partie sur pa.exemple.fr')
    expect(sansDate.incomplet).toBe('Relevé incomplet : la plateforme n’a pas tout rendu. Relancez la lecture pour la suite.')
    // Complet mais sans instant (ne devrait pas arriver) : on ne prétend pas une date.
    expect(bilanDuReleve(releve({ cycle_vie_lu_le: null }), new Map(), dateDe).titre).toBe('Statuts lus en partie sur pa.exemple.fr')
  })

  it('un point de reprise non enregistré se dit, et rien n’est perdu — sans le redire quand la phrase le dit déjà', () => {
    expect(bilanDuReleve(releve({ erreur_reprise: 'La connexion a changé.' }), new Map(), dateDe).reprise)
      .toBe('La connexion a changé. Rien n’est perdu : le prochain relevé relira ces statuts, et reconnaîtra ceux déjà gardés.')
    const deja = 'Le point de reprise des statuts n’a pas pu être enregistré (x) : la lecture suivante relira ces statuts, et les reconnaîtra.'
    expect(bilanDuReleve(releve({ erreur_reprise: deja }), new Map(), dateDe).reprise).toBe(deja)
  })
})

describe('un relevé refusé', () => {
  it('la phrase de la fonction telle quelle, et ce qu’il faut faire quand la plateforme refuse l’identité', () => {
    const sans = { acces_refuse: false, identifiants_refuses: false }
    expect(refusDuReleve('Réessayez.', sans)).toBe('Réessayez.')
    expect(refusDuReleve('Refus (401).', { ...sans, identifiants_refuses: true })).toBe(
      'Refus (401). L’identifiant ou le secret enregistrés ne sont plus acceptés : demandez-en de nouveaux au client, puis '
      + 'saisissez-les par « Modifier » dans la fenêtre « Plateforme du client » (onglet Justificatifs).',
    )
    expect(refusDuReleve('Refus (403).', { ...sans, acces_refuse: true })).toBe(
      'Refus (403). Demandez au client d’ouvrir au cabinet le droit de lire les flux de son entreprise sur sa plateforme.',
    )
  })
})

describe('la phrase avant de déclarer : ce qui est SU d’un refus de l’acheteur', () => {
  const HOTE = 'pa.exemple.fr'
  const connexion = (o: Partial<{ hote: string; cycle_vie_lu_le: string | null }> = {}) => ({ hote: HOTE, cycle_vie_lu_le: null, ...o })

  it('un refus ou un rejet lu : rien à vérifier', () => {
    expect(verificationAvantDeclaration(HOTE, [{ code: '205' }, { code: '210' }], connexion(), null, dateDe)).toEqual({ etat: 'refusee' })
    expect(verificationAvantDeclaration(HOTE, [{ code: '213' }], undefined, 'x', dateDe)).toEqual({ etat: 'refusee' })
  })

  it('lus jusqu’au bout, sans refus : la date, et le relevé offert', () => {
    expect(verificationAvantDeclaration(HOTE, [{ code: '205' }], connexion({ cycle_vie_lu_le: '2026-10-09T09:00:00Z' }), null, dateDe)).toEqual({
      etat: 'lus', relevable: true,
      texte: 'Statuts lus sur pa.exemple.fr le [2026-10-09T09:00:00Z] : aucun refus de l’acheteur. Un refus posé depuis n’est '
        + 'connu qu’en relisant les statuts.',
    })
  })

  const NON_LUS = 'Les statuts de pa.exemple.fr n’ont pas encore été lus : lisez-les avant de déclarer — un refus de l’acheteur '
    + 'annule la facture, et aucun statut « Encaissée » ne la suit.'

  it('pas encore lus : l’invitation, le relevé offert sur la plateforme même ; ailleurs, pourquoi il ne l’est pas', () => {
    expect(verificationAvantDeclaration(HOTE, [], connexion(), null, dateDe)).toEqual({ etat: 'non_lus', relevable: true, texte: NON_LUS })
    expect(verificationAvantDeclaration(HOTE, [], null, null, dateDe)).toEqual({
      etat: 'non_lus', relevable: false,
      texte: `${NON_LUS} Aucune plateforme n’est reliée au dossier pour les lire : reliez-la dans l’onglet Justificatifs (« Plateforme du client »).`,
    })
    expect(verificationAvantDeclaration(HOTE, [], undefined, 'Accès refusé.', dateDe)).toEqual({
      etat: 'non_lus', relevable: false,
      texte: `${NON_LUS} La connexion à la plateforme n’a pas pu être lue (Accès refusé.) : les statuts ne se relèvent pas d’ici.`,
    })
    expect(verificationAvantDeclaration(HOTE, [], undefined, null, dateDe)).toEqual({
      etat: 'non_lus', relevable: false,
      texte: `${NON_LUS} La connexion à la plateforme n’a pas pu être lue : les statuts ne se relèvent pas d’ici.`,
    })
    // Lue jusqu'au bout, mais sur une AUTRE plateforme : ce n'est pas celle qui a accepté la facture.
    expect(verificationAvantDeclaration(HOTE, [], connexion({ hote: 'autre.fr', cycle_vie_lu_le: '2026-10-09T09:00:00Z' }), null, dateDe)).toEqual({
      etat: 'non_lus', relevable: false,
      texte: `${NON_LUS} La plateforme reliée au dossier est aujourd’hui autre.fr : les statuts de pa.exemple.fr ne se relèvent pas d’ici.`,
    })
  })
})
