import { describe, expect, it } from 'vitest'
import {
  confirmationDEcarter, confirmationDeSupprimer, ecartable, envoisDuMouvement, premiersMots, refusDEcarter,
  type EnvoisDuClient, type EtatDeLaProposition,
} from './banqueCabinet'
import { LIBELLE_DE_L_ETAT } from './banqueClient'
import type { AccesDuDossier } from './auteursVentes'
import type { JustificatifPropose, LigneBancaire, PrecisionMouvement } from './types'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { messagesSql } from '../test/raiseSql'

// « ÉCARTER CETTE PROPOSITION » et « SUPPRIMER CE MESSAGE » (espace client, étape P9b2) : ce que le module dit AVANT le clic.
// Données FICTIVES. Les mots du refus sont ceux de `retirer_proposition`, relus dans son texte exporté ; la suppression d'un
// message tient à une policy, relue dans l'export.

function proposition(o: Partial<JustificatifPropose> = {}): JustificatifPropose {
  return {
    id: 'prop-1', dossier_id: 'd1', ligne_bancaire_id: 'l1', piece_id: 'p1', auteur_id: 'client-1', origine: 'client',
    created_at: '2026-06-05T10:00:00Z', retire_le: null, retire_par: null, ...o,
  }
}

function precision(o: Partial<PrecisionMouvement> = {}): PrecisionMouvement {
  return {
    id: 'q1', dossier_id: 'd1', ligne_bancaire_id: 'l1', auteur_id: 'cabinet-1', origine: 'cabinet', texte: 'De quoi s’agit-il ?',
    created_at: '2026-06-06T10:00:00Z', ...o,
  }
}

function ligne(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2026-06-02', montant: -100, libelle: 'PRLV FICTIF', libelle_brut: null,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
    reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-06-02T09:00:00Z', ...o,
  }
}

const ACCES: AccesDuDossier = { etat: 'lus', comptes: ['client-1'] }

function siens(propositions: JustificatifPropose[], precisions: PrecisionMouvement[]) {
  const envois: Extract<EnvoisDuClient, { etat: 'lus' }> = { etat: 'lus', propositions, precisions }
  return envoisDuMouvement(envois, 'l1')
}

describe('qui peut être écartée', () => {
  const etat = (e: EtatDeLaProposition['etat']): EtatDeLaProposition => ({ etat: e } as EtatDeLaProposition)

  it('la proposition courante du client, quel que soit ce qu’il en advient, sauf quand le mouvement la retient', () => {
    expect(ecartable(proposition(), etat('a_associer'))).toBe(true)
    expect(ecartable(proposition(), etat('mouvement_classe'))).toBe(true)
    expect(ecartable(proposition(), etat('piece_figee'))).toBe(true)
    expect(ecartable(proposition(), etat('retenue'))).toBe(false)
  })

  it('jamais une proposition du cabinet, ni une proposition déjà retirée', () => {
    expect(ecartable(proposition({ origine: 'cabinet' }), etat('a_associer'))).toBe(false)
    expect(ecartable(proposition({ retire_le: '2026-06-06T10:00:00Z', retire_par: 'client-1' }), etat('a_associer'))).toBe(false)
  })
})

describe('ce que retirer_proposition refuserait au cabinet, avant le clic', () => {
  const sql = derniereDefinitionSql('retirer_proposition')
  const mots = messagesSql(sql)

  it('une proposition du dossier, de n’importe quel auteur : rien à redire (le cabinet est admis par la fonction)', () => {
    expect(refusDEcarter('d1', proposition())).toBeNull()
    expect(refusDEcarter('d1', proposition({ auteur_id: 'un-autre-compte' }))).toBeNull()
  })

  it('l’autre dossier, sous les mots de la fonction (refus 2)', () => {
    expect(refusDEcarter('d2', proposition())).toBe(mots[1].replace("''", "'"))
  })

  it('déjà retirée, et quand — le jour de Paris, sous les mots de la fonction (refus 4)', () => {
    const message = refusDEcarter('d1', proposition({ retire_le: '2026-04-01T22:30:00Z', retire_par: 'client-1' }))
    // 22 h 30 UTC le 1er avril : il est déjà le 2 avril à Paris, comme `to_char(… at time zone 'Europe/Paris')`.
    expect(message).toBe(mots[3].replace('%', '02/04/2026'))
    expect(message).toContain('depuis le 02/04/2026')
  })

  it('l’auteur n’est pas jugé : le cabinet retire la proposition d’un autre (refus 3 de la fonction, jamais pour lui)', () => {
    expect(refusDEcarter('d1', proposition({ auteur_id: 'cabinet-2' }))).toBeNull()
  })
})

describe('la confirmation de l’écart dit ce que le client verra ensuite, tiré de etatDuMouvement', () => {
  it('une seule proposition : le mouvement ne sera plus « Justificatif envoyé »', () => {
    const e = siens([proposition()], [])
    const texte = confirmationDEcarter(ligne(), e, proposition(), 'facture.pdf')
    expect(texte).toContain(`le client verra ensuite ce mouvement « ${LIBELLE_DE_L_ETAT.sans_justificatif} » (il le voit aujourd’hui « ${LIBELLE_DE_L_ETAT.propose} »)`)
    expect(texte).toContain('« facture.pdf »')
  })

  it('une question en attente : « Demandé par ton cabinet » prend la place', () => {
    const e = siens([proposition()], [precision()])
    expect(confirmationDEcarter(ligne(), e, proposition(), 'f.pdf'))
      .toContain(`verra ensuite ce mouvement « ${LIBELLE_DE_L_ETAT.demande} »`)
  })

  it('une autre proposition reste : le client voit toujours « Justificatif envoyé »', () => {
    const autre = proposition({ id: 'prop-2', piece_id: 'p2' })
    const e = siens([proposition(), autre], [])
    const texte = confirmationDEcarter(ligne(), e, proposition(), 'f.pdf')
    expect(texte).toContain(`le client verra toujours ce mouvement « ${LIBELLE_DE_L_ETAT.propose} »`)
    expect(texte).not.toContain('verra ensuite')
  })

  it('un mouvement classé : l’écart ne change rien à ce que le client voit, et la phrase le dit', () => {
    const rapprochee = ligne({ statut: 'rapprochee', piece_id: 'p9' })
    const texte = confirmationDEcarter(rapprochee, siens([proposition()], []), proposition(), 'f.pdf')
    expect(texte).toContain(`le client verra toujours ce mouvement « ${LIBELLE_DE_L_ETAT.justifie_piece} »`)
  })

  it('dit que la pièce reste dans ses pièces, que la proposition reste au registre, et où écrire pour expliquer', () => {
    const texte = confirmationDEcarter(ligne(), siens([proposition()], []), proposition(), 'f.pdf')
    expect(texte).toContain('La pièce reste dans ses pièces')
    expect(texte).toContain('la proposition reste au registre, retirée par le cabinet et datée')
    expect(texte).toContain('écris-lui dans le fil')
  })

  it('ne dépend que de la proposition écartée : les autres se comptent sur leur identifiant', () => {
    const autre = proposition({ id: 'prop-2', piece_id: 'p2' })
    const texte = confirmationDEcarter(ligne(), siens([proposition(), autre], []), autre, 'g.pdf')
    expect(texte).toContain('toujours')
  })
})

describe('les premiers mots d’un message', () => {
  it('un message court se garde tel quel, les blancs ramenés à une espace', () => {
    expect(premiersMots('  Le  logiciel\ndu cabinet  ')).toBe('Le logiciel du cabinet')
  })

  it('un message long se coupe entre deux mots, et le dit', () => {
    const long = 'un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize'
    const court = premiersMots(long)
    expect(court.endsWith('…')).toBe(true)
    expect(long.startsWith(court.slice(0, -1))).toBe(true)
    expect([...court].length).toBeLessThanOrEqual(61)
    // Coupé après un mot entier : le caractère qui suit la coupure, dans l'original, est une espace.
    expect(long[court.length - 1]).toBe(' ')
  })

  it('exactement à la limite : rien n’est coupé', () => {
    const soixante = `${'a'.repeat(29)} ${'b'.repeat(30)}`
    expect([...soixante].length).toBe(60)
    expect(premiersMots(soixante)).toBe(soixante)
    expect(premiersMots(`${soixante}c`)).toBe(`${'a'.repeat(29)}…`)
  })

  it('un seul mot plus long que la limite se coupe', () => {
    const mot = 'x'.repeat(100)
    expect(premiersMots(mot)).toBe(`${'x'.repeat(60)}…`)
  })

  it('compte en caractères : une émoticône vaut un', () => {
    const emoticones = '😀'.repeat(60)
    expect(premiersMots(emoticones)).toBe(emoticones)
  })

  it('rien à dire d’un message de blancs', () => {
    expect(premiersMots(' \n ')).toBe('')
  })
})

describe('la confirmation de la suppression d’un message', () => {
  it('le NOMME : qui, quand, ses premiers mots ; dit que le client ne le verra plus et que c’est définitif', () => {
    const q = precision({ texte: 'À quoi correspond ce prélèvement ?' })
    const texte = confirmationDeSupprimer(ligne(), ACCES, siens([], [q]), q)
    expect(texte).toContain('Le cabinet, le 06/06/2026 : « À quoi correspond ce prélèvement ? »')
    expect(texte).toContain('Le client ne le verra plus.')
    expect(texte).toContain('La suppression est définitive')
  })

  it('un message du client est nommé « Le client » (accès lus) ; un compte sans accès, dit tel', () => {
    const q = precision({ id: 'q2', origine: 'client', auteur_id: 'client-1', texte: 'Le logiciel du cabinet.' })
    expect(confirmationDeSupprimer(ligne(), ACCES, siens([], [q]), q)).toContain('Le client, le 06/06/2026 : « Le logiciel du cabinet. »')
    const retire: AccesDuDossier = { etat: 'lus', comptes: [] }
    expect(confirmationDeSupprimer(ligne(), retire, siens([], [q]), q)).toContain('un compte qui ne porte plus d’accès')
  })

  it('un long message n’est cité que par ses premiers mots', () => {
    const q = precision({ texte: `${'mot '.repeat(40)}fin` })
    const texte = confirmationDeSupprimer(ligne(), ACCES, siens([], [q]), q)
    expect(texte).toContain('mot mot mot… »')
    expect(texte).not.toContain('mot fin')
  })

  it('la dernière question en attente supprimée : le client ne verra plus « Demandé par ton cabinet »', () => {
    const q = precision()
    const texte = confirmationDeSupprimer(ligne(), ACCES, siens([], [q]), q)
    expect(texte).toContain(`il verra ensuite ce mouvement « ${LIBELLE_DE_L_ETAT.sans_justificatif} » (il le voit aujourd’hui « ${LIBELLE_DE_L_ETAT.demande} »)`)
  })

  it('une question plus ancienne que la réponse du client : la supprimer ne change rien à ce qu’il voit', () => {
    const q = precision()
    const reponse = precision({ id: 'q2', origine: 'client', auteur_id: 'client-1', created_at: '2026-06-07T10:00:00Z' })
    const texte = confirmationDeSupprimer(ligne(), ACCES, siens([], [q, reponse]), q)
    expect(texte).not.toContain('il verra ensuite')
  })

  it('une question encore en attente après la suppression de la réponse : le client verra « Demandé par ton cabinet »', () => {
    const q = precision()
    const reponse = precision({ id: 'q2', origine: 'client', auteur_id: 'client-1', created_at: '2026-06-07T10:00:00Z' })
    const texte = confirmationDeSupprimer(ligne(), ACCES, siens([], [q, reponse]), reponse)
    expect(texte).toContain(`il verra ensuite ce mouvement « ${LIBELLE_DE_L_ETAT.demande} » (il le voit aujourd’hui « ${LIBELLE_DE_L_ETAT.sans_justificatif} »)`)
  })

  it('avec une pièce proposée, le fil n’y change rien', () => {
    const q = precision()
    const texte = confirmationDeSupprimer(ligne(), ACCES, siens([proposition()], [q]), q)
    expect(texte).not.toContain('il verra ensuite')
  })
})

describe('la base permet les deux gestes, relus dans l’export du schéma', () => {
  const texte = fichiersDuSchema().map((f) => f.texte).join('\n')

  it('la policy qui ouvre la suppression d’un message au cabinet du dossier', () => {
    expect(texte).toMatch(
      /create policy precisions_mouvements_suppression_cabinet on public\.precisions_mouvements\s+for delete to authenticated using \(admin_du_dossier\(dossier_id\)\)/,
    )
    expect(texte).not.toMatch(/drop policy (if exists )?precisions_mouvements_suppression_cabinet/)
  })

  it('aucun déclencheur ne s’oppose à la suppression d’un message : il garde l’insertion et la modification seulement', () => {
    const declencheurs = [...texte.matchAll(/create trigger \w+\s+(before|after) ([a-z ]+?) on public\.precisions_mouvements/g)]
    expect(declencheurs.length).toBeGreaterThan(0)
    for (const d of declencheurs) expect(d[2]).not.toContain('delete')
  })

  it('retirer_proposition est exécutable par un compte connecté, et pas par anon', () => {
    expect(texte).toContain('grant execute on function public.retirer_proposition(uuid, uuid) to authenticated;')
    expect(texte).toContain('revoke execute on function public.retirer_proposition(uuid, uuid) from public, anon;')
  })
})
