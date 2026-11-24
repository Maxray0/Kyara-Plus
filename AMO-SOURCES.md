# Kyara Plus — sources

Extension Firefox/Chrome pour `https://kyara.games`, construite avec WXT 0.21.5, Vite et
TypeScript. Ce dépôt contient l'intégralité des sources du paquet soumis à
addons.mozilla.org : aucun code privé, aucune dépendance privée, aucun sous-module. Le code
est distribué sous licence MIT (voir `LICENSE`).

## Environnement testé

- Windows 11, Node.js 26.13.1
- pnpm 12.18.0 (version imposée par le champ `packageManager`)
- Installation depuis le registre npm public uniquement

Les relecteurs peuvent utiliser Node.js 24.14.0 (environnement AMO par défaut) : aucune
étape ne dépend du système d'exploitation.

## Construction

```bash
corepack enable
corepack prepare pnpm@12.18.0 --activate
pnpm install --frozen-lockfile
pnpm build:firefox
```

Le dossier produit est `.output/firefox-mv3/`. Son contenu est identique à celui du zip
`kyara-plus-<version>-firefox.zip` soumis, hors signature AMO.

Pour Chrome :

```bash
pnpm build
```

Le dossier produit est `.output/chrome-mv3/`.

## Correspondance avec le paquet

Le zip Firefox contient `manifest.json`, `background.js`, les pages HTML générées
(`stats.html`, `doublons.html`), les content scripts, les styles et les icônes. Tout est
produit par les commandes ci-dessus ; aucun fichier n'est ajouté après le build.

Les fichiers présents ici mais absents du paquet (ce fichier, `README.md`, `.gitignore`)
ne sont pas utilisés à l'exécution.

## Données et réseau

- Aucun serveur développeur, aucune analytique, aucune publicité.
- Les requêtes vont uniquement à `https://kyara.games/*` avec la session du site.
- Le jeton de session est lu depuis la page et conservé en mémoire (`storage.session`) ;
  il n'est jamais écrit sur disque.
- Les réglages, caches et historiques restent dans `storage.local` du navigateur.
- L'extension déclare `data_collection_permissions.required = ["none"]`.

## Notes de test

Kyara Plus s'utilise sur un compte kyara.games connecté. Les fonctions de lecture (prix,
collection, statistiques, boosters) sont accessibles dès que la session est présente. Les
écritures de jeu demandent deux vrais clics et ne sont jamais automatiques sans réglage
explicite.
