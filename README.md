# Bot Discord Promotion & DM

Ce bot permet d'automatiser la promotion de contenu via des messages avec boutons, l'attribution de rôles, et l'envoi de DM uniques.

## Pré-requis importants (Discord Developer Portal)

⚠️ **Pour que le bot fonctionne, vous devez activer les "Privileged Gateway Intents" sur le portail développeur Discord.**

1.  Allez sur [Discord Developer Portal](https://discord.com/developers/applications).
2.  Sélectionnez votre application.
3.  Allez dans l'onglet **Bot** (menu de gauche).
4.  Descendez à la section **Privileged Gateway Intents**.
5.  Activez (cochez) les options suivantes :
    *   **PRESENCE INTENT** (Optionnel, mais souvent utile)
    *   **SERVER MEMBERS INTENT** (Requis pour gérer les rôles et le DM de masse)
    *   **MESSAGE CONTENT INTENT** (Requis pour lire les messages et commandes)
6.  Cliquez sur **Save Changes**.

Si ces options ne sont pas activées, le bot plantera au démarrage avec l'erreur `Used disallowed intents`.

## Installation

1.  Les dépendances sont déjà installées. Si besoin : `npm install`
2.  Le token est déjà configuré dans le fichier `.env`.

## Configuration

Ouvrez le fichier `config.json` et modifiez les paramètres suivants :

```json
{
  "configs": [
    {
      "channelId": "ID_DU_SALON_A_SURVEILLER",
      "roleId": "ID_DU_ROLE_A_DONNER",
      "buttonLabel": "Devenir Fan",
      "promoTitle": "🔥 Contenu Exclusif",
      "promoMessage": "Message qui apparait dans le salon...",
      "dmContent": "Lien ou texte à envoyer en DM (image/gif/video)",
      "dmEnabled": true
    }
  ],
  "adminRoles": ["ID_ROLE_ADMIN"],
  "prefix": "!"
}
```

*   **channelId** : L'ID du salon où le bot détectera les messages.
*   **roleId** : L'ID du rôle que le bot donnera/retirera.
*   **dmContent** : Le contenu du message privé (URL d'une image/vidéo ou texte).
*   **dmEnabled** : `true` pour activer les DM, `false` pour désactiver.

Vous pouvez ajouter plusieurs configurations dans la liste `configs` (pour gérer plusieurs salons/créateurs).

## Utilisation

### 1. Lancer le bot
Ouvrez un terminal et tapez :
```bash
node index.js
```

### 2. Fonctionnement automatique
*   Postez un message dans un salon configuré.
*   Le bot répondra avec le message promotionnel et le bouton.
*   Les utilisateurs cliquant sur le bouton recevront le rôle et un DM (une seule fois).

### 3. Commande DM de Masse
Pour envoyer un message à tous les membres d'un rôle (réservé aux admins) :

```
!dmall <ID_DU_ROLE> Votre message ici
```
Exemple :
```
!dmall 123456789012345678 Hey les VIP, nouvelle vidéo dispo !
```

## Notes
*   Le fichier `data.json` stocke l'historique des DM envoyés pour ne pas spammer les utilisateurs. Ne le supprimez pas si vous voulez conserver cet historique.
