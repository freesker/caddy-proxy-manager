# Design — Accès aux hosts forward-auth piloté par les rôles Keycloak

- **Date** : 2026-06-01
- **Statut** : Validé (brainstorming) — prêt pour le plan d'implémentation
- **Périmètre** : Synchroniser les rôles Keycloak (OIDC) vers les groupes CPM au login, afin de
  piloter l'accès par host du portail Forward Auth via le modèle d'accès existant.

## Contexte et problème

CPM possède trois couches d'authentification distinctes, et **aucune ne mappe nativement
« rôle Keycloak → accès à un host »** :

1. **OAuth/OIDC** (`OAUTH_*` / Settings → OAuth Providers) : sert uniquement à se connecter
   au dashboard et au portail. À la connexion, CPM crée/lie un utilisateur CPM avec un rôle
   interne (`user` par défaut) — les claims `realm_access.roles` de Keycloak ne sont jamais lus.
2. **Forward Auth Portal** (`src/lib/models/forward-auth.ts`) : protège les proxy hosts ;
   l'accès est accordé par **utilisateur/groupe CPM**, par host
   (`checkHostAccess` → `forwardAuthAccess`).
3. **Intégration Authentik** : forward-auth délégué à un outpost Authentik (spécifique Authentik).

Objectif utilisateur : « donner accès à certains sites à certains users en fonction de leur
rôle Keycloak », en restant dans le modèle CPM (portail Forward Auth + accès par host).

Constat de code (vérifié) :

- Aucun mapping claim/rôle OIDC → groupe/rôle n'existe (`src/lib/auth-server.ts` n'a pas de
  `mapProfileToUser`).
- L'appartenance aux groupes passe par `groupMembers` ; `addGroupMember` / `removeGroupMember` /
  `getGroupsForUser` (`src/lib/models/groups.ts`).
- Le verify forward-auth renvoie déjà l'en-tête `X-CPM-Groups`
  (`app/api/forward-auth/verify/route.ts`).

## Objectifs

- Au login Keycloak, refléter les rôles de l'utilisateur dans son appartenance aux **groupes CPM**,
  via un **mapping explicite rôle → groupe** géré par l'admin.
- L'accès groupe → host reste l'UI Forward Auth existante (inchangée).
- Couvrir les deux surfaces de connexion (dashboard `/login` et portail `/portal`), qui passent
  toutes deux par `genericOAuth` (`authClient.signIn.social`).

## Non-objectifs (hors v1)

- Mapper le **rôle dashboard** (viewer/user/admin) depuis Keycloak — reste manuel.
- Synchronisation en arrière-plan / continue — la synchro a lieu **uniquement au login**.
- Hiérarchies de groupes / rôles composites côté CPM.
- Modifier l'attribution groupe → host (elle existe déjà).

## Décisions (issues du brainstorming)

1. **Mécanisme** : portail Forward Auth CPM (réutilise tout le modèle utilisateurs/groupes).
2. **Mapping** : explicite **rôle Keycloak → groupe CPM** (pas d'auto-création de groupes,
   pas de rôle requis par host).
3. **Sémantique de synchro** : les groupes cibles d'un mapping sont **100 % pilotés par Keycloak**
   (ajout **et** retrait au login). Pas de colonne `source` ; ces groupes ne sont pas édités à la
   main (verrouillés dans l'UI).
4. **Extraction des rôles** : lecture du claim de rôles dans le flux OIDC (approche A), claim
   configurable par provider (défaut `realm_access.roles`). Nécessite un protocol mapper Keycloak.
5. **Garde-fou** : badge + verrouillage des groupes managés sur la page Groups (conservé en v1).

## Architecture

```
Login Keycloak (dashboard OU portail)
        │  genericOAuth → profil OIDC (claim rolesClaim, def. realm_access.roles)
        ▼
[getUserInfo override]  ── préserve id/email/name (profil standard)
        │                ── extrait le tableau de rôles
        │                ── stash mémoire indexé par `sub` (durée = la requête)
        ▼
[databaseHooks.session.create.after]  (à chaque login, dispose du userId)
        │   ── lit les rôles stashés pour ce `sub`
        │   ── syncUserGroupsFromRoles(userId, providerId, roles)
        ▼
groupMembers (groupes "managés" recalculés)  →  forward-auth verify (checkHostAccess par groupe)
```

## Modèle de données

### Table `oauthRoleMappings` (nouvelle)

| Colonne      | Type    | Notes                                                        |
|--------------|---------|-------------------------------------------------------------|
| `id`         | serial  | PK                                                          |
| `providerId` | text    | FK → `oauthProviders.id`, **ON DELETE CASCADE**            |
| `role`       | text    | Nom du rôle Keycloak                                        |
| `groupId`    | integer | FK → `groups.id`, **ON DELETE CASCADE**                    |
| `createdAt`  | text    | ISO                                                        |

- Index **unique** `(providerId, role, groupId)`.
- Sémantique : « le rôle `role` du provider `providerId` alimente le groupe `groupId` ».
- Plusieurs rôles peuvent cibler le même groupe (union → sémantique **OU** : avoir l'un des rôles
  suffit à appartenir au groupe).

### Colonne `rolesClaim` sur `oauthProviders` (nouvelle)

- `text`, nullable → interprété comme `realm_access.roles` si absent.
- Chemin de claim « pointé » (dot-path) : `realm_access.roles`,
  `resource_access.<client>.roles`, ou un claim plat (`groups`, `roles`).
- Petit ajout au dialogue provider (`OAuthProvidersSection.tsx`) + modèle
  (`src/lib/models/oauth-providers.ts`, parse/create/update) + `syncEnvOAuthProviders`
  (variable d'env optionnelle `OAUTH_ROLES_CLAIM`).

## Intégration better-auth

Contrainte : les rôles ne sont disponibles que dans le flux OIDC, mais la synchro doit s'exécuter
**à chaque login** ; or au 1er login l'utilisateur CPM n'existe pas encore au moment où le profil
est lu.

Plan retenu, dans `mapOAuthProvider` / `createAuth` (`src/lib/auth-server.ts`) :

1. **`getUserInfo` override** sur la config genericOAuth :
   - Appelle la résolution standard du profil (préserve `id`/`email`/`name` — ne casse pas la
     création/liaison de compte existante).
   - Extrait en plus le tableau de rôles via `rolesClaim` (depuis l'ID token décodé et/ou la
     réponse userinfo).
   - Dépose `{ sub → roles }` dans un **stash mémoire** (Map) à durée de vie courte (la requête
     de callback). `getUserInfo` s'exécute à chaque login → couvre 1er login + suivants.
2. **`databaseHooks.session.create.after`** (s'exécute à chaque login, dispose du `userId`) :
   - Résout le `sub`/provider de l'utilisateur, lit les rôles stashés, appelle
     `syncUserGroupsFromRoles(userId, providerId, roles)`, puis vide l'entrée du stash.

**Risque à confirmer en phase plan** : comportement exact des hooks genericOAuth de
`better-auth@^1.6.11` (signature de `getUserInfo`, accès aux tokens/ID token, ordonnancement vs
`session.create.after`). **Fallback** si le stash mémoire ne convient pas : persister les rôles du
dernier login sur la ligne `accounts` (champ dédié) et lire depuis là dans le hook de session.

## Fonction de synchro

`syncUserGroupsFromRoles(userId: number, providerId: string, roles: string[] | undefined)` :

1. Si `roles` est **`undefined`** (claim absent → mapper Keycloak probablement non configuré) :
   **skip + `console.warn`**, ne rien modifier. *Évite de retirer l'accès à tout le monde en cas
   de mauvaise config.*
2. `mappings` = lignes `oauthRoleMappings` du `providerId`.
3. `managedGroupIds` = ensemble des `groupId` présents dans `mappings` (groupes « managés »).
4. `targetGroupIds` = `groupId` dont le `role` ∈ `roles` (union).
5. Appartenances actuelles de l'utilisateur ∩ `managedGroupIds` = `currentManaged`.
6. **Ajouts** : `targetGroupIds \ currentManaged` → `addGroupMember`.
7. **Retraits** : `currentManaged \ targetGroupIds` → `removeGroupMember`.
8. Les groupes **non managés** ne sont jamais touchés.
9. Toute la fonction est enveloppée dans un `try/catch` : un échec **ne casse pas le login**
   (log only).

Cas `roles` **présent mais vide `[]`** : étape 1 ne s'applique pas → les retraits de l'étape 7
s'appliquent normalement (l'utilisateur n'a légitimement aucun rôle mappé).

`actorUserId` pour l'audit : un acteur « système » (à définir — soit l'utilisateur lui-même, soit
un marqueur système ; à trancher en plan, l'audit log existant attend un `userId`).

## UI

### Settings — nouvelle carte « Keycloak Role → Group Mappings »

- Placée près de *OAuth Providers* (`app/(dashboard)/settings/`).
- Champs : sélecteur de provider (si > 1), champ rôle (texte libre), sélecteur de groupe (liste des
  groupes existants), bouton Ajouter ; liste des mappings avec suppression.
- Même pattern server-action que `app/(dashboard)/settings/actions.ts` (admin only, via
  `requireApiAdmin` côté API si exposé).

### Page Groups — badge + verrouillage des groupes managés

- Un groupe est **« managé »** s'il est cible d'au moins un `oauthRoleMappings`.
- **Badge** *« Géré par Keycloak »* à côté du nom (style cohérent avec les badges existants
  `ENV`/`UI`/`Disabled`).
- **Verrouillage** : boutons « ajouter / retirer un membre » **désactivés** (grisés + infobulle
  « appartenance pilotée par les rôles Keycloak »). Édition nom/description et suppression du groupe
  restent autorisées.
- Implémentation : exposer un flag `managed` par groupe (jointure/`EXISTS` sur `oauthRoleMappings`)
  au composant Groups.

### Accès groupe → host

- **Inchangé** : l'admin attribue les groupes (managés) aux hosts via l'UI Forward Auth existante.

## Configuration Keycloak (documentation utilisateur)

Par défaut Keycloak ne place pas les rôles dans userinfo / ID token. Ajouter un mapper :

1. Realm → Clients → `<client CPM>` → **Client scopes** → le scope dédié du client → **Add mapper**.
2. Type **User Realm Role** (ou **User Client Role** pour des rôles de client) :
   - **Multivalued** : ON
   - **Token Claim Name** : `realm_access.roles` (doit correspondre au `rolesClaim` côté CPM)
   - **Add to ID token** : ON, **Add to userinfo** : ON
3. Assigner les rôles realm/client aux utilisateurs.

Côté CPM : `rolesClaim` du provider = le *Token Claim Name* choisi (défaut `realm_access.roles`).

## Gestion des erreurs / cas limites

- **Claim absent** (undefined) → skip + warning (pas de retrait massif).
- **Claim vide** (`[]`) → retraits appliqués.
- **Échec de synchro** → capturé, loggé, login non interrompu.
- **Rôles Keycloak par défaut** (`offline_access`, `uma_authorization`, `default-roles-<realm>`) →
  sans effet tant qu'aucun mapping ne les cible (mappings explicites).
- **Provider supprimé** → cascade supprime ses mappings.
- **Groupe supprimé** → cascade supprime les mappings le référençant.
- **Plusieurs providers** → synchro scoping par provider : un login ne gère que les groupes mappés
  pour **ce** provider.

## Stratégie de tests

- **Unitaires** `syncUserGroupsFromRoles` (table-driven) :
  ajout ; retrait ; claim-absent → skip ; claim-vide → retrait ; groupe non managé intact ;
  plusieurs rôles → même groupe ; scoping par provider.
- **Intégration** : login OIDC simulé avec rôles → assertion de l'appartenance puis de
  `checkHostAccess` (réutilise `tests/integration/`).
- **E2E (option)** : harness Dex existant (`tests/dex/config.yml`) émettant un claim `groups` →
  `rolesClaim=groups`, mapper un groupe Dex → groupe CPM → host protégé, assertion accès
  accordé/refusé (réutilise `tests/e2e/functional/forward-auth-oauth.spec.ts`).

## Questions ouvertes / à confirmer en phase plan

1. Câblage exact des hooks `genericOAuth` (`getUserInfo`) de better-auth 1.6.x et accès à
   l'ID token ; sinon fallback persistance sur `accounts`.
2. `actorUserId` à utiliser pour les événements d'audit de la synchro automatique.
3. Forme exacte de l'API/server-actions pour les mappings (réutilisation du style `oauth-providers`).
