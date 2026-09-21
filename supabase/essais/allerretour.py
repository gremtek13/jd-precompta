#!/usr/bin/env python3
"""Aller-retour : compare la copie DÉPLOYÉE d'une Edge Function au fichier du dépôt.

À REJOUER après chaque `deploy_edge_function`, jamais à lire. C'est la seule preuve que les lignes
retransmises sont arrivées au caractère près — l'empreinte `ezbr_sha256` ne prouve, elle, que le
DÉTERMINISME de la transformation : une transcription fautive redéployée rend deux fois la même.

COMMENT ÇA MARCHE, ET POURQUOI ÇA NE COÛTE RIEN. Le résultat de `get_edge_function` est écrit dans
le journal de session (`~/.claude/projects/<projet>/<session>.jsonl`), qui porte chaque appel d'outil
avec son résultat. On l'y relit plutôt que de le retranscrire — la transcription est précisément ce
que cet aller-retour vérifie, elle ne peut donc pas servir aussi de référence.

    python3 supabase/essais/allerretour.py <id-de-fonction> <chemin/du/depot/index.ts> [marqueur]

`<id-de-fonction>` est l'uuid que rend `list_edge_functions` (champ `id`). Le `marqueur` facultatif
est un bout de texte que SEULE la version attendue contient : sans lui, le journal peut encore porter
une lecture ANTÉRIEURE de la même fonction, et l'aller-retour comparerait alors le dépôt à la version
qu'on vient de remplacer — vert pour une raison fausse.

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


def source_deployee(identifiant: str, marqueur: str | None) -> str | None:
    """La plus longue lecture de cette fonction trouvée dans le journal."""
    meilleure = None
    for ligne in open(journal(), encoding='utf8'):
        # Les guillemets sont échappés dans le JSONL : on ne peut filtrer que sur un identifiant nu.
        if identifiant not in ligne:
            continue
        try:
            objet = json.loads(ligne)
        except ValueError:
            continue
        contenu = objet.get('message', {}).get('content')
        if not isinstance(contenu, list):
            continue
        for bloc in contenu:
            if bloc.get('type') != 'tool_result':
                continue
            texte = bloc.get('content')
            if isinstance(texte, list):
                texte = ''.join(x.get('text', '') for x in texte)
            if not isinstance(texte, str) or '"name":"index.ts","content":"' not in texte:
                continue
            if marqueur and marqueur not in texte:
                continue
            if meilleure is None or len(texte) > len(meilleure):
                meilleure = texte
    if meilleure is None:
        return None
    debut = meilleure.index('"name":"index.ts","content":"') + len('"name":"index.ts","content":')
    reste = meilleure[debut:]
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
    identifiant, chemin = sys.argv[1], sys.argv[2]
    marqueur = sys.argv[3] if len(sys.argv) > 3 else None

    deploye = source_deployee(identifiant, marqueur)
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
