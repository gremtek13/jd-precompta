import { describe, expect, it } from 'vitest'
import { contact } from '../test/contacts'
import { REFUS_ENREGISTREMENT_CONTACT } from './contacts'
import { contactDeLaProvenance, contactsAChoisir } from './contactsFacture'
import { contactsSansActivite } from './contactsInactifs'
import { contactsAffichables, contactsAffiches } from './contactsVue'
import { estFicheLiee, motsDuRefusDeLaFicheLiee, type EtatDeLaFicheLiee, type IdentiteLue } from './fichesLiees'
import {
  confirmationDeLaLiaison, dossiersARelier, fichesLieesAChoisir, fichesLieesDuDossier, ligneDesFichesTues, ligneDUneFicheLiee,
  refusDeLaSaisieDeFicheLiee, saisieInitialeDeFicheLiee, type DossierDuCabinetLu, type SaisieDeFicheLiee,
} from './fichesLieesVue'

// LA FICHE LIÉE, À L'ÉCRAN (LM3) : ce que la vue « Clients » du dossier du cabinet et le choix d'un client dans la facture en
// disent, et la garde des lecteurs d'hier — une fiche liée n'a pas de nom ; aucun d'eux ne la montre. Données FICTIVES.
const K = '1b300000-0000-4000-8000-0000000000a1'
const C = '1b300000-0000-4000-8000-0000000000c1'
const C2 = '1b300000-0000-4000-8000-0000000000c2'
const C3 = '1b300000-0000-4000-8000-0000000000c3'

// Une fiche liée telle que la base la rend : sans nom ni identité (le type dit `nom: string` jusqu'au collage).
const liee = (o: Partial<ReturnType<typeof contact>> = {}) => contact({
  id: 'f1', dossier_id: K, nom: null as unknown as string, type_client: null, adresse: null, siren: null, siret: null,
  dossier_client_id: C, delai_paiement_jours: 30, email: 'compta@essai.invalid', ...o,
})
const ordinaire = contact({ id: 'c1', dossier_id: K, nom: 'Aubert SAS' })
const lue = (i: Partial<IdentiteLue> = {}): IdentiteLue => ({
  contact_id: 'f1', dossier_client_id: C, dossier_present: true, tiers_nom: 'CLIENT SARL', tiers_adresse: '1 rue A',
  tiers_siret: '12345678200010', tiers_siren: '123456782', type_client: 'assujetti', ...i,
})
const dossier = (id: string, nom: string, siret: string | null = null): DossierDuCabinetLu => ({
  id, nom, denomination_imprimee: null, adresse: null, siret,
})
const etat = (e: Partial<EtatDeLaFicheLiee> = {}): EtatDeLaFicheLiee => ({
  estDossierDuCabinet: true, dossierDuCabinetId: K, dossiersDuCabinet: [K, C, C2], fiches: [], ficheReecrite: null, ...e,
})
const saisie = (s: Partial<SaisieDeFicheLiee> = {}): SaisieDeFicheLiee => ({ ...saisieInitialeDeFicheLiee(null), dossierClientId: C2, ...s })
const mot = (cle: (typeof REFUS_ENREGISTREMENT_CONTACT)[number]['cle']) => REFUS_ENREGISTREMENT_CONTACT.find((r) => r.cle === cle)?.modele

describe('les lecteurs d’hier écartent une fiche liée (LM3)', () => {
  it('une colonne absente n’est pas un lien : drapeau baissé, rien ne change', () => {
    const { dossier_client_id: _absente, ...sansColonne } = ordinaire
    expect(estFicheLiee(sansColonne)).toBe(false)
    expect(estFicheLiee({ ...ordinaire, dossier_client_id: null })).toBe(false)
    expect(estFicheLiee(liee())).toBe(true)
  })

  it('ni la liste, ni le choix, ni les clients sans activité, ni la provenance ne montrent une fiche sans nom', () => {
    const tous = [ordinaire, liee()]
    expect(contactsAffichables(tous).map((c) => c.id)).toEqual(['c1'])
    expect(contactsAffiches(tous, true).map((c) => c.id)).toEqual(['c1'])
    expect(contactsAChoisir(tous, null, '').offerts.map((c) => c.id)).toEqual(['c1'])
    expect(contactsSansActivite(tous, [], new Date('2031-01-01T10:00:00Z')).map((s) => s.contact.id)).toEqual(['c1'])
    expect(contactDeLaProvenance('f1', tous)).toBeNull()
    expect(contactDeLaProvenance('c1', tous)?.id).toBe('c1')
  })
})

describe('la vue des fiches liées (LM3)', () => {
  it('les fiches du dossier : liées, non effacées, ce qui est propre à la facturation, et la version lue (LM3-Q1 (B))', () => {
    const fiches = fichesLieesDuDossier([ordinaire, liee(), liee({ id: 'f2', efface_le: '2027-01-01T00:00:00Z', dossier_client_id: C2 })])
    expect(fiches).toEqual([{
      id: 'f1', dossier_client_id: C, adresse_electronique: null, email: 'compta@essai.invalid', delai_paiement_jours: 30,
      observations: null, retire_le: null, efface_le: null, modifie_le: null,
    }])
  })

  it('les dossiers à relier : hors du dossier du cabinet, sans fiche (retirée comprise), par nom', () => {
    const libres = dossiersARelier([dossier(K, 'Cabinet'), dossier(C3, 'Zoé'), dossier(C, 'Alpha'), dossier(C2, 'bêta')], K, [{ dossier_client_id: C }])
    expect(libres.map((d) => d.nom)).toEqual(['bêta', 'Zoé'])
  })

  it('la ligne d’une fiche : l’identité LUE, le dossier parti, l’identité illisible', () => {
    const [fiche] = fichesLieesDuDossier([liee()])
    expect(ligneDUneFicheLiee(fiche, [lue()])).toEqual({
      etat: 'lue', nom: 'CLIENT SARL', detail: 'Entreprise établie en France · SIRET 12345678200010 · délai 30 jours',
    })
    expect(ligneDUneFicheLiee(fiche, [lue({ dossier_present: false, tiers_nom: null, type_client: null })])).toEqual({ etat: 'dossierParti' })
    expect(ligneDUneFicheLiee(fiche, [])).toEqual({ etat: 'illisible' })
  })

  it('le refus d’une saisie : dans l’ordre de la base, à ses mots, sur le texte saisi', () => {
    const entreprise = { typeClient: 'assujetti' as const, siren: '123456782' }
    expect(refusDeLaSaisieDeFicheLiee(etat(), saisie({ dossierClientId: '' }), null, null)).toBe('Choisir le dossier du client à relier.')
    expect(refusDeLaSaisieDeFicheLiee(etat(), saisie({ dossierClientId: K }), null, null)).toBe(motsDuRefusDeLaFicheLiee('dossier'))
    expect(refusDeLaSaisieDeFicheLiee(etat({ fiches: [{ id: 'f9', dossier_client_id: C2, retire_le: '2027-01-01' }] }), saisie(), null, null))
      .toBe(motsDuRefusDeLaFicheLiee('dejaLieeRetiree'))
    expect(refusDeLaSaisieDeFicheLiee(etat(), saisie({ adresseElectronique: '123456782' }), { typeClient: 'non_assujetti', siren: null }, null))
      .toBe(mot('adresse_electronique_type'))
    expect(refusDeLaSaisieDeFicheLiee(etat(), saisie({ adresseElectronique: '12345' }), entreprise, null)).toBe(mot('adresse_electronique_forme'))
    expect(refusDeLaSaisieDeFicheLiee(etat(), saisie({ adresseElectronique: '987654324' }), entreprise, null)).toBe(mot('adresse_electronique_siren'))
    expect(refusDeLaSaisieDeFicheLiee(etat(), saisie({ adresseElectronique: '123456782' }), null, null)).toMatch(/ne se juge pas/)
    expect(refusDeLaSaisieDeFicheLiee(etat(), saisie({ email: 'pas une adresse' }), null, null)).toBe(mot('email_invalide'))
    // Un délai illisible se REFUSE : `saisieDeLaFicheLiee` le ferait partir nul, en silence.
    for (const delai of ['abc', '1.5', '-1', '61']) expect(refusDeLaSaisieDeFicheLiee(etat(), saisie({ delai }), null, null), delai).toBe(mot('delai_invalide'))
    expect(refusDeLaSaisieDeFicheLiee(etat(), saisie({ observations: 'é'.repeat(1001) }), null, null)).toBe(mot('observations_longues'))
    expect(refusDeLaSaisieDeFicheLiee(etat(), saisie({ adresseElectronique: ' 123456782 ', email: 'a@b.fr', delai: '60', observations: 'é'.repeat(1000) }), entreprise, null)).toBeNull()
    // Une fiche réécrite : retirée, elle se reprend d'abord ; son lien ne change pas.
    const reecrite = etat({ ficheReecrite: { id: 'f1', dossier_client_id: C } })
    expect(refusDeLaSaisieDeFicheLiee(reecrite, saisie({ dossierClientId: C }), null, { retire_le: '2027-01-01' })).toBe(mot('retire'))
    expect(refusDeLaSaisieDeFicheLiee(reecrite, saisie({ dossierClientId: C2 }), null, { retire_le: null })).toBe(motsDuRefusDeLaFicheLiee('lienFixe'))
    expect(refusDeLaSaisieDeFicheLiee(reecrite, saisie({ dossierClientId: C }), null, { retire_le: null })).toBeNull()
  })

  it('la confirmation NOMME le dossier relié et ce que la fiche garde', () => {
    const c = confirmationDeLaLiaison('Dossier Essai', saisie({ email: 'a@b.fr', delai: '15', observations: 'note' }))
    expect(c.titre).toBe('Relier le dossier « Dossier Essai » ?')
    expect(c.garde).toEqual(['l’e-mail a@b.fr', 'le délai de paiement de 15 jours', 'les observations saisies'])
    expect(c.regle).toMatch(/ne change plus/)
    expect(confirmationDeLaLiaison('X', saisie()).garde).toHaveLength(1)
  })

  it('le choix dans une facture : en cours et lues seulement, les autres comptées et dites', () => {
    const contacts = [
      ordinaire, liee(), liee({ id: 'f2', dossier_client_id: C2 }), liee({ id: 'f3', dossier_client_id: C3 }),
      liee({ id: 'f4', dossier_client_id: K, retire_le: '2027-01-01T00:00:00Z' }),
    ]
    const identites = [lue(), lue({ contact_id: 'f2', dossier_client_id: C2, dossier_present: false, tiers_nom: null, type_client: null })]
    const r = fichesLieesAChoisir(contacts, identites, '2027-11-01')
    expect(r.offertes.map((f) => [f.fiche.id, f.nom, f.choix.echeance])).toEqual([['f1', 'CLIENT SARL', { delai: 30, date: '2027-12-01' }]])
    expect([r.parties, r.illisibles]).toEqual([1, 1])
    expect(ligneDesFichesTues(1, 1)).toBe(
      'Ne se proposent pas : 1 fiche dont le dossier est parti et 1 fiche dont l’identité ne s’est pas lue.')
    expect(ligneDesFichesTues(2, 0)).toBe('Ne se proposent pas : 2 fiches dont le dossier est parti.')
    expect(ligneDesFichesTues(0, 0)).toBeNull()
  })
})
