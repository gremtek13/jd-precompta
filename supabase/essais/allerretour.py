#!/usr/bin/env python3
"""Aller-retour : compare la copie DÉPLOYÉE d'une Edge Function au fichier du dépôt.

À REJOUER après chaque `deploy_edge_function`, jamais à lire. C'est la seule preuve que les lignes
retransmises sont arrivées au caractère près — l'empreinte `ezbr_sha256` ne prouve, elle, que le
DÉTERMINISME de la transformation : une transcription fautive redéployée rend deux fois la même.

COMMENT ÇA MARCHE, ET POURQUOI ÇA NE COÛTE RIEN. Le résultat de `get_edge_function` est écrit dans
le journal de session (`~/.claude/projects/<projet>/<session>.jsonl`), qui porte chaque appel d'outil
avec son résultat. On l'y relit plutôt que de le retranscrire — la transcription est précisément ce
que cet aller-retour vérifie, elle ne peut donc pas servir aussi de référence.

    python3 supabase/essais/allerretour.py <slug-ou-id> <chemin/du/depot/index.ts> [marqueur]

`<slug-ou-id>` est le nom de la fonction (`extract-piece`) ou l'uuid que rend `list_edge_functions`.

C'EST LA LECTURE LA PLUS RÉCENTE QUI COMPTE, et le journal en porte plusieurs : celle d'avant
l'écrasement (la comparaison au dépôt), puis celle d'après. Jusqu'au 30/09/2026 ce script retenait la
plus LONGUE — juste tant que chaque lecture est plus longue que la précédente, faux dès qu'une version
raccourcit : un fichier dont on retire des lignes (rouge sur un déploiement juste), ou une
transcription fautive plus courte que la lecture juste qui la précède (VERT sur un déploiement faux).
Ce second cas n'a rien de théorique : le 30/09/2026, deux redéploiements de `receive-email` ont
perdu quatre traits d'une bordure de commentaire — ils suivaient, par chance, une lecture plus courte.
Le `marqueur` facultatif reste utile : un bout de texte que SEULE la version attendue contient, pour
refuser une lecture faite avant le déploiement si aucune n'a été faite après.

ET UNE FONCTION VOLUMINEUSE N'EST PAS DANS LE JOURNAL : son résultat dépasse ce que la conversation
accepte, il est écrit sur disque, et le journal ne porte que le message qui en donne le chemin
(« saved to … », un `.txt` ou un `.json` fait de blocs de texte). Ce script le suit. Avant, il rendait
« INTROUVABLE » sur `extract-piece` et `agent-comptable`, c'est-à-dire sur les deux fonctions dont la
transcription est la plus longue, donc la plus exposée.

CE QU'IL PROUVE : la transcription. CE QU'IL NE PROUVE PAS : que la fonction s'exécute, ni ce qu'elle
a le DROIT de faire chez AWS (voir `edgeFunctionsIam.test.ts`), ni son `verify_jwt` — qui se relit
dans le résultat du déploiement et se repasse explicitement à chaque fois.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from glob import glob


def journal() -> str:
    """Le journal de la session EN COURS — le plus récemment écrit."""
    fichiers = glob(os.path.expanduser('~/.claude/projects/*/*.jsonl'))
    if not fichiers:
        raise SystemExit("Aucun journal de session trouvé sous ~/.claude/projects/")
    return max(fichiers, key=os.path.getmtime)


MARQUE = '"name":"index.ts","content":"'


def texte_du_resultat(bloc: dict) -> str:
    """Le texte d'un résultat d'outil — relu sur disque quand il y a été écrit faute de place."""
    texte = bloc.get('content')
    if isinstance(texte, list):
        texte = ''.join(x.get('text', '') for x in texte if isinstance(x, dict))
    if not isinstance(texte, str):
        return ''
    chemin = re.search(r'saved to:? ?(\S+\.(?:txt|json))', texte)
    if chemin and os.path.exists(chemin.group(1)):
        texte = open(chemin.group(1), encoding='utf8').read()
        # Écrit en .json, c'est un tableau de blocs {type, text} : on en recolle le texte.
        if chemin.group(1).endswith('.json'):
            blocs = json.loads(texte)
            if isinstance(blocs, list):
                texte = ''.join(b.get('text', '') for b in blocs if isinstance(b, dict))
    return texte


def source_deployee(fonction: str, marqueur: str | None) -> str | None:
    """La lecture la plus RÉCENTE de cette fonction dans le journal (voir l'en-tête)."""
    appels = {}  # identifiant d'appel -> fonction demandée à get_edge_function
    derniere = None
    for ligne in open(journal(), encoding='utf8'):
        try:
            objet = json.loads(ligne)
        except ValueError:
            continue
        contenu = objet.get('message', {}).get('content')
        if not isinstance(contenu, list):
            continue
        for bloc in contenu:
            if not isinstance(bloc, dict):
                continue
            if bloc.get('type') == 'tool_use' and bloc.get('name', '').endswith('get_edge_function'):
                appels[bloc.get('id')] = (bloc.get('input') or {}).get('function_slug')
                continue
            if bloc.get('type') != 'tool_result' or bloc.get('tool_use_id') not in appels:
                continue
            texte = texte_du_resultat(bloc)
            # Désignée par son nom, ou par l'uuid que porte le résultat lui-même.
            if appels[bloc['tool_use_id']] != fonction and f'"id":"{fonction}"' not in texte:
                continue
            if MARQUE not in texte or (marqueur and marqueur not in texte):
                continue
            derniere = texte
    if derniere is None:
        return None
    debut = derniere.index(MARQUE) + len(MARQUE) - 1
    reste = derniere[debut:]
    # Un résultat volumineux est TRONQUÉ, parfois au milieu d'une séquence d'échappement : on
    # raccourcit jusqu'à obtenir une chaîne JSON valide, et le compte de lignes dira ensuite que la
    # comparaison ne porte pas sur tout le fichier.
    while True:
        try:
            return json.loads(reste if reste.rstrip().endswith('"') else reste + '"')
        except ValueError:
            reste = reste[:-1]
            if len(reste) < 10:
                raise


def main() -> int:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    fonction, chemin = sys.argv[1], sys.argv[2]
    marqueur = sys.argv[3] if len(sys.argv) > 3 else None

    deploye = source_deployee(fonction, marqueur)
    if deploye is None:
        print("INTROUVABLE dans le journal — le résultat de get_edge_function n'y est pas encore écrit")
        return 1

    brut = open(chemin, encoding='utf8').read()
    # Déployer par l'outil MCP DÉCODE les échappements `\\uXXXX` : on applique le même décodage à la
    # source du dépôt, sinon toute classe de caractères écrite en échappement ressortirait comme une
    # différence. Ne JAMAIS « corriger » en doublant les antislashs côté source (voir CLAUDE.md).
    echappements = len(re.findall(r'\\u[0-9a-fA-F]{4}', brut))
    attendu = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), brut)

    lignes_deployees = deploye.count('\n')
    partiel = lignes_deployees < attendu.count('\n')
    if partiel:
        attendu = '\n'.join(attendu.split('\n')[:lignes_deployees]) + '\n'

    fichiers = []
    for contenu in (deploye, attendu):
        with tempfile.NamedTemporaryFile('w', suffix='.ts', delete=False, encoding='utf8') as f:
            f.write(contenu)
            fichiers.append(f.name)
    resultat = subprocess.run(['diff', '-u', *fichiers], capture_output=True, text=True)
    for f in fichiers:
        os.unlink(f)

    if resultat.returncode != 0:
        print(resultat.stdout[:8000])
        return 1
    portee = f"{lignes_deployees} lignes"
    if partiel:
        portee += " (TRONQUÉ — la fin du fichier n'est pas couverte)"
    print(f"ALLER-RETOUR : zéro différence résiduelle sur {portee}, "
          f"{echappements} échappement(s) décodé(s)")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
