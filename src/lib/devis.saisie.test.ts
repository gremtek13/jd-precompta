import { describe, expect, it } from 'vitest'
import {
  confirmationDeLaSuppressionDevis, confirmationDeLEmission, ecritureDuDevis, factureTireeDe, ligneDevisVide, lignesDeLaSaisie,
  lignesSaisiesDuDevis, refusDeLaSaisieDevis, refusEnregistrementDevis, saisieDuDevis, totauxDeLaSaisie, type DefautsDuDevis,
  type SaisieDevis,
} from './devis'
import { MENTION_FRANCHISE } from './statutTva'
import { devis, lienDevisFacture } from '../test/devis'
import type { EmissionAJuger } from './devis'

// CE QUE LES ÉCRANS DE L'ÉTAPE P6a1 TIRENT DU MODULE DES DEVIS : la saisie d'un devis neuf ou d'un brouillon lu, ses lignes
// en textes lues en nombres (jamais zéro pour un champ vide), ses refus dans l'ordre de la base puis des mentions, et les deux
// confirmations, qui nomment ce qui part. Données FICTIVES.

// L'émetteur que la base lirait dans le dossier A de l'essai (son jeu j1), pour un accès « Ventes ».
const EMISSION: EmissionAJuger = {
  dossier: { nom: 'ESSAI DEVIS A', siret: '12345678200010', adresse: "1 rue de l'Essai, 75001 Paris", forme_juridique: '5710', denomination_imprimee: 'ESSAI DEVIS A SAS' },
  cabinet: false,
}

const DEFAUTS: DefautsDuDevis = {
  aujourdHui: '2026-01-31', statutTva: 'franchise', articleExoneration: null,
}

const saisieComplete = (p: Partial<SaisieDevis> = {}): SaisieDevis => ({
  ...saisieDuDevis(null, DEFAUTS),
  tiersNom: 'ALPHA FICTIVE SAS',
  lignes: [{ designation: 'Conseil', quantite: 2, prix_unitaire_ht: 150.25, taux_tva: 0 }],
  ...p,
})

describe('la saisie d’un devis', () => {
  it('neuf : daté du jour, valable un mois au quantième (le dernier jour du mois quand il manque), la mention de TVA proposée', () => {
    const s = saisieDuDevis(null, DEFAUTS)
    expect(s.dateEmission).toBe('2026-01-31')
    expect(s.dateValidite).toBe('2026-02-28')
    expect(s.mentionsLegales).toBe(MENTION_FRANCHISE)
    expect(s.tiersNom).toBe('')
    // Aucun émetteur : la base le pose à l'émission, depuis le dossier.
    expect(Object.keys(s).filter((k) => k.startsWith('emetteur'))).toEqual([])
    expect(s.mentions.prestation).toBe('facture')
  })

  it('un brouillon lu : ses valeurs, ses mentions ; l’émetteur qu’il garderait n’entre pas dans la saisie', () => {
    const d = devis({
      objet: 'Étude', notes: 'à relancer', mentions_legales: null, type_client: 'assujetti', tiers_siren: '123456782',
      periode_debut: '2026-03-01', periode_fin: '2026-03-31', emetteur_nom: 'Ancien nom',
    })
    const s = saisieDuDevis(d, DEFAUTS)
    expect(s).toMatchObject({
      dateEmission: '2026-10-01', dateValidite: '2026-11-01', objet: 'Étude', notes: 'à relancer', mentionsLegales: '',
      tiersNom: 'ALPHA FICTIVE SAS',
    })
    expect(s.mentions).toMatchObject({ typeClient: 'assujetti', siren: '123456782', prestation: 'periode', periodeDebut: '2026-03-01' })
  })

  it('les lignes : une ligne vide au taux du statut, un brouillon en textes', () => {
    expect(ligneDevisVide('redevable', 'a').taux).toBe('20')
    expect(ligneDevisVide('franchise', 'a').taux).toBe('0')
    expect(ligneDevisVide(null, 'a').taux).toBe('0')
    expect(lignesSaisiesDuDevis(null, 'redevable')).toEqual([{ cle: 'l0', designation: '', quantite: '1', prix: '', taux: '20' }])
    expect(lignesSaisiesDuDevis(devis(), null)).toEqual([{ cle: 'l0', designation: 'Conseil', quantite: '1', prix: '1000', taux: '20' }])
  })

  it('un nombre saisi : la virgule admise, un vide ou un texte n’est pas un nombre — jamais zéro', () => {
    const [l] = lignesDeLaSaisie([{ cle: 'a', designation: 'x', quantite: ' 1,5 ', prix: '', taux: '2x' }])
    expect(l.quantite).toBe(1.5)
    expect(l.prix_unitaire_ht).toBeNaN()
    expect(l.taux_tva).toBeNaN()
    expect(lignesDeLaSaisie([{ cle: 'a', designation: 'x', quantite: '1e3', prix: '0x10', taux: '-5,5' }])[0])
      .toMatchObject({ quantite: Number.NaN, prix_unitaire_ht: Number.NaN, taux_tva: -5.5 })
  })

  it('les totaux affichés ne comptent que les lignes lisibles', () => {
    const t = totauxDeLaSaisie([
      { cle: 'a', designation: 'x', quantite: '2', prix: '100', taux: '20' },
      { cle: 'b', designation: 'y', quantite: '1', prix: '', taux: '20' },
    ])
    expect(t).toMatchObject({ montant_ht: 200, montant_tva: 40, montant_ttc: 240 })
  })

  it('« facturé » se lit des liens du devis', () => {
    expect(factureTireeDe('dv1', [lienDevisFacture({ devis_id: 'dv1' })])).toBe(true)
    expect(factureTireeDe('dv1', [lienDevisFacture({ devis_id: 'dv2' })])).toBe(false)
    expect(factureTireeDe('dv1', [])).toBe(false)
  })
})

describe('les refus de la saisie, avant le clic', () => {
  it('ceux de la base d’abord, sous ses mots ; une ligne au prix vide n’est pas une ligne de devis', () => {
    const vide = saisieComplete({ tiersNom: ' ' })
    expect(refusDeLaSaisieDevis('d1', { nouveau: true }, vide, false, '2026-01-31', EMISSION)).toBe('Le nom du client est à renseigner.')
    const sansPrix = saisieComplete({ lignes: lignesDeLaSaisie([{ cle: 'a', designation: 'x', quantite: '1', prix: '', taux: '0' }]) })
    expect(refusDeLaSaisieDevis('d1', { nouveau: true }, sansPrix, false, '2026-01-31', EMISSION)).toMatch(/^La ligne 1 n'est pas une ligne de devis/)
  })

  it('le même refus que `refusEnregistrementDevis` sur l’écriture qui part', () => {
    const s = saisieComplete({ dateValidite: '2026-01-01' })
    const attendu = refusEnregistrementDevis('d1', { nouveau: true }, ecritureDuDevis(s, false), '2026-01-31', EMISSION)
    expect(refusDeLaSaisieDevis('d1', { nouveau: true }, s, false, '2026-01-31', EMISSION)).toBe(attendu?.message)
  })

  it('l’émission en ajoute : un devis daté de l’avenir s’enregistre en brouillon, mais ne s’émet pas', () => {
    const s = saisieComplete({ dateEmission: '2026-02-01', dateValidite: '2026-03-01' })
    expect(refusDeLaSaisieDevis('d1', { nouveau: true }, s, false, '2026-01-31', EMISSION)).toBeNull()
    expect(refusDeLaSaisieDevis('d1', { nouveau: true }, s, true, '2026-01-31', EMISSION)).toBe('Un devis ne s\'émet pas daté de l\'avenir : nous sommes le 31/01/2026.')
  })

  it('puis ceux des mentions du client, que la base juge après', () => {
    const s = saisieComplete({ mentions: { ...saisieComplete().mentions, typeClient: 'assujetti', siren: '12345' } })
    expect(refusDeLaSaisieDevis('d1', { nouveau: true }, s, false, '2026-01-31', EMISSION)).toBe('Le SIREN du client s’écrit en neuf chiffres.')
  })

  it('un brouillon devenu émis ne se réécrit plus', () => {
    const cible = { nouveau: false as const, devis: devis({ statut: 'emis', numero: 'D2026-0001' }) }
    expect(refusDeLaSaisieDevis('d1', cible, saisieComplete(), false, '2026-01-31', EMISSION))
      .toBe('Le devis D2026-0001 est émis : il ne se modifie plus — il se duplique.')
  })

  it('une saisie juste : aucun refus, ni pour le brouillon ni pour l’émission', () => {
    expect(refusDeLaSaisieDevis('d1', { nouveau: true }, saisieComplete(), false, '2026-01-31', EMISSION)).toBeNull()
    expect(refusDeLaSaisieDevis('d1', { nouveau: true }, saisieComplete(), true, '2026-01-31', EMISSION)).toBeNull()
  })
})

describe('les confirmations nomment ce qui part', () => {
  it('l’émission : le client, le total, la validité, la série de l’année de sa date, et ce qui ne se défera plus', () => {
    const texte = confirmationDeLEmission(saisieComplete({ dateEmission: '2027-01-02', dateValidite: '2027-02-02' }))
    expect(texte).toContain('« ALPHA FICTIVE SAS »')
    expect(texte.replace(/\s/g, ' ')).toContain('300,50 € TTC')
    expect(texte).toContain('valable jusqu’au 02/02/2027')
    expect(texte).toContain('prochain numéro de la série D2027')
    expect(texte).toContain('ne se modifiera plus')
  })

  it('la suppression : le client, la date et le total du brouillon, et qu’elle est irréversible', () => {
    const texte = confirmationDeLaSuppressionDevis(devis())
    expect(texte).toContain('« ALPHA FICTIVE SAS » du 01/10/2026')
    expect(texte.replace(/\s/g, ' ')).toContain('1 200,00 € TTC')
    expect(texte).toContain('irréversible')
  })
})
