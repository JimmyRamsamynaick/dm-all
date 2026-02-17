const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- Configuration ---
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_PATH = path.join(__dirname, 'data.json');

// Load config
let config = require(CONFIG_PATH);
// Load data
let data = require(DATA_PATH);

function ensureDmFolder() {
    const folder = path.join(__dirname, 'dm_files');
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }
    return folder;
}

function downloadAttachmentToLocal(url, filename) {
    return new Promise((resolve, reject) => {
        const folder = ensureDmFolder();
        const filePath = path.join(folder, filename);
        const file = fs.createWriteStream(filePath);

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                file.close(() => {
                    fs.unlink(filePath, () => reject(new Error(`Download failed with status ${response.statusCode}`)));
                });
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve(filePath));
            });
        }).on('error', (err) => {
            file.close(() => {
                fs.unlink(filePath, () => reject(err));
            });
        });
    });
}

function saveData() {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function saveConfig() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// --- Client Setup ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User]
});

// --- Events ---

client.once('ready', () => {
    if (client.user.username !== "La voix de Kaelys") {
        client.user.setUsername("La voix de Kaelys").catch(console.error);
    }
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Bot is ready to watch ${config.configs.length} channels.`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // 1. Check for Commands
    if (message.content.startsWith(config.prefix)) {
        await handleCommand(message);
        return;
    }

    // 2. Check for Monitored Channels
    const channelConfig = config.configs.find(c => c.channelId === message.channel.id);
    if (channelConfig) {
        await handlePromoTrigger(message, channelConfig);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    await handleButtonInteraction(interaction);
});

// --- Handlers ---

async function handlePromoTrigger(message, channelConfig) {
    try {
        // Create the button
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`toggle_role_${channelConfig.channelId}`)
                    .setLabel(channelConfig.buttonLabel || "Accéder")
                    .setStyle(ButtonStyle.Danger) // Red color often used for "HOT" or "Exclusive"
            );

        // Create Embed (optional, but looks better) or just text
        // User asked for "Un texte personnalisable". Let's use an Embed for "Contenu Exclusif" look.
        const embed = new EmbedBuilder()
            .setColor(0xFF0000) // Red
            .setTitle(channelConfig.promoTitle || "🔥 Contenu Exclusif")
            .setDescription(channelConfig.promoMessage || "Cliquez ci-dessous !");
            
        // Check for promo attachment
        if (channelConfig.promoAttachment) {
            embed.setImage(channelConfig.promoAttachment);
        }

        await message.channel.send({
            embeds: [embed],
            components: [row]
        });

        console.log(`Promo message sent in ${message.channel.id}`);

    } catch (error) {
        console.error("Error sending promo message:", error);
    }
}

async function handleButtonInteraction(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('toggle_role_')) return;

    const channelId = customId.replace('toggle_role_', '');
    const channelConfig = config.configs.find(c => c.channelId === channelId);

    if (!channelConfig) {
        return interaction.reply({ content: "Configuration introuvable pour ce bouton.", ephemeral: true });
    }
    
    // Fix for DM clicks where guild might be missing in interaction
    let guild = interaction.guild;
    let targetMember = interaction.member;

    if (!guild) {
        // Try to fetch guild from channel config if possible, or fail gracefully
        try {
            const channel = await client.channels.fetch(channelConfig.channelId);
            if (channel) {
                guild = channel.guild;
                // Fetch member in that guild
                targetMember = await guild.members.fetch(interaction.user.id);
            }
        } catch (err) {
            console.error("Could not fetch guild from channel config:", err);
            return interaction.reply({ content: "Impossible de trouver le serveur lié à ce bouton.", ephemeral: true });
        }
    }

    const roleId = channelConfig.roleId;
    const role = guild.roles.cache.get(roleId);

    if (!role) {
        return interaction.reply({ content: "Le rôle configuré est introuvable sur ce serveur.", ephemeral: true });
    }

    // Check if user has role
    if (targetMember.roles.cache.has(roleId)) {
        // REMOVE ROLE
        try {
            await targetMember.roles.remove(role);
            await interaction.reply({ content: `➖ Rôle **${role.name}** retiré.`, ephemeral: true });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: "Erreur lors du retrait du rôle. Vérifiez mes permissions.", ephemeral: true });
        }
    } else {
        // ADD ROLE
        try {
            // Check DM logic BEFORE adding role to ensure logic flows correctly
            let replyMessage = `➕ Rôle **${role.name}** ajouté !`;
            const userKey = `${interaction.user.id}_${channelConfig.channelId}`;
            
            if (channelConfig.dmEnabled && !data[userKey]) {
                // Send DM
                try {
                    const dmContent = channelConfig.dmContent;
                    
                    const dmPayload = {
                        content: `Voici ton contenu exclusif pour **${role.name}** :\n${dmContent}`
                    };

                    if (channelConfig.dmAttachment) {
                        dmPayload.files = [channelConfig.dmAttachment];
                    }

                    await interaction.user.send(dmPayload);
                    
                    // Mark as received
                    data[userKey] = true;
                    saveData();
                    
                    replyMessage += "\n📩 Je t'ai envoyé un DM avec ton cadeau !";
                } catch (dmError) {
                    console.error(`Could not DM user ${interaction.user.tag}:`, dmError);
                    replyMessage += "\n⚠️ Je n'ai pas pu t'envoyer de DM (tes messages privés sont peut-être fermés).";
                }
            }

            await targetMember.roles.add(role);
            await interaction.reply({ content: replyMessage, ephemeral: true });

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: "Erreur lors de l'ajout du rôle. Vérifiez mes permissions.", ephemeral: true });
        }
    }
}

async function handleCommand(message) {
    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Check admin permissions (Owner or Admin Role)
    if (message.author.id !== config.ownerId && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        if (!config.adminRoles || !config.adminRoles.some(r => message.member.roles.cache.has(r))) {
            return; 
        }
    }

    if (command === 'blacklist') {
        // Usage: !blacklist <add|remove|list> <user|role> <id>
        if (args.length === 0) {
            return message.reply("Usage: `!blacklist <add|remove|list> <user|role> <id>`");
        }

        const action = args[0].toLowerCase();

        // Ensure blacklist config exists
        if (!config.blacklist) config.blacklist = { users: [], roles: [] };

        if (action === 'list') {
            const users = config.blacklist.users.map(id => `<@${id}>`).join(', ') || "Aucun";
            const roles = config.blacklist.roles.map(id => `<@&${id}>`).join(', ') || "Aucun";
            
            const embed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle("⛔ Blacklist DM All")
                .addFields(
                    { name: 'Utilisateurs', value: users },
                    { name: 'Rôles', value: roles }
                );
            return message.reply({ embeds: [embed] });
        }

        if (args.length < 3) {
            return message.reply("Usage: `!blacklist <add|remove> <user|role> <id>`");
        }

        const type = args[1].toLowerCase();
        const targetId = args[2].replace(/[<@&>]/g, ''); // Strip mentions

        if (action === 'add') {
            if (type === 'user') {
                if (!config.blacklist.users.includes(targetId)) {
                    config.blacklist.users.push(targetId);
                    saveConfig();
                    return message.reply(`✅ Utilisateur <@${targetId}> ajouté à la blacklist.`);
                } else {
                    return message.reply("Cet utilisateur est déjà dans la blacklist.");
                }
            } else if (type === 'role') {
                if (!config.blacklist.roles.includes(targetId)) {
                    config.blacklist.roles.push(targetId);
                    saveConfig();
                    return message.reply(`✅ Rôle <@&${targetId}> ajouté à la blacklist.`);
                } else {
                    return message.reply("Ce rôle est déjà dans la blacklist.");
                }
            }
        } else if (action === 'remove') {
             if (type === 'user') {
                const index = config.blacklist.users.indexOf(targetId);
                if (index > -1) {
                    config.blacklist.users.splice(index, 1);
                    saveConfig();
                    return message.reply(`🗑️ Utilisateur <@${targetId}> retiré de la blacklist.`);
                } else {
                    return message.reply("Cet utilisateur n'est pas dans la blacklist.");
                }
            } else if (type === 'role') {
                const index = config.blacklist.roles.indexOf(targetId);
                if (index > -1) {
                    config.blacklist.roles.splice(index, 1);
                    saveConfig();
                    return message.reply(`🗑️ Rôle <@&${targetId}> retiré de la blacklist.`);
                } else {
                    return message.reply("Ce rôle n'est pas dans la blacklist.");
                }
            }
        }
        
        return message.reply("Type invalide. Utilisez `user` ou `role`.");
    }

    if (command === 'dmall') {
        // Usage: !dmall <roleId> [--btn <channelId>] <message...>
        if (args.length < 2 && message.attachments.size === 0) {
            return message.reply("Usage: `!dmall <roleId> [--btn <channelId>] <message>`");
        }

        const roleId = args[0].replace('<@&', '').replace('>', '');
        
        let dmText = args.slice(1).join(' ');
        let buttonConfig = null;

        if (dmText.includes('--btn')) {
            const parts = dmText.split('--btn');
            dmText = parts[0].trim();
            const afterFlag = parts[1].trim();
            
            const potentialChannelId = afterFlag.split(' ')[0].replace('<#', '').replace('>', '');
            
            if (potentialChannelId && config.configs.find(c => c.channelId === potentialChannelId)) {
                buttonConfig = config.configs.find(c => c.channelId === potentialChannelId);
            } else if (config.configs.length === 1) {
                buttonConfig = config.configs[0];
            } else {
                 if (config.configs.length > 0) {
                     buttonConfig = config.configs[0];
                 }
            }
        }

        const role = message.guild.roles.cache.get(roleId);
        if (!role) {
            return message.reply("Rôle introuvable.");
        }

        message.reply(`🔄 Lancement du DM de masse pour le rôle **${role.name}** (${role.members.size} membres)...`);

        let successCount = 0;
        let failCount = 0;
        
        let components = [];
        if (buttonConfig) {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`toggle_role_${buttonConfig.channelId}`)
                        .setLabel(buttonConfig.buttonLabel || "Accéder")
                        .setStyle(ButtonStyle.Danger)
                );
            components.push(row);
        }

        const files = Array.from(message.attachments.values());

        // Fetch all members to be sure cache is full
        // Using { force: false } to avoid fetching if already cached, but here we likely need full list.
        // HOWEVER, force fetching a huge guild triggers rate limits (Opcode 8).
        // Better approach: fetch only if cache size is small compared to memberCount, or rely on chunking.
        // For simple bots, just accessing cache might be enough if GatewayIntentBits.GuildMembers is on.
        // If we really need to fetch all, we should catch errors.
        
        try {
            await message.guild.members.fetch();
        } catch (fetchError) {
            console.error("Error fetching members:", fetchError);
            // Continue with what we have in cache if fetch fails
        }
        
        const members = role.members;

        for (const [memberId, member] of members) {
            if (member.user.bot) continue;

            // Check Blacklist
            if (config.blacklist) {
                if (config.blacklist.users.includes(memberId)) {
                    // console.log(`Skipped blacklisted user: ${member.user.tag}`);
                    continue;
                }
                if (config.blacklist.roles.some(rId => member.roles.cache.has(rId))) {
                    // console.log(`Skipped user with blacklisted role: ${member.user.tag}`);
                    continue;
                }
            }

            try {
                const payload = {};
                if (dmText.length > 0) payload.content = dmText;
                if (files.length > 0) payload.files = files;
                if (components.length > 0) payload.components = components;

                if (Object.keys(payload).length === 0) continue;

                await member.send(payload);
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {
                failCount++;
                console.log(`Failed to DM ${member.user.tag}: ${err.message}`);
            }
        }

        message.channel.send(`✅ DM de masse terminé pour **${role.name}**.\nEnvoyés : ${successCount}\nEchecs : ${failCount}`);
    
    } else if (command === 'resetdm') {
        // Usage: !resetdm [user]
        let targetId = message.author.id;
        let targetUser = message.author;

        if (args.length > 0) {
            // Check if mentioning a user
            const mention = args[0].replace('<@', '').replace('>', '');
            targetId = mention;
            try {
                targetUser = await client.users.fetch(targetId);
            } catch (e) {
                return message.reply("Utilisateur introuvable.");
            }
        }

        let deletedCount = 0;
        // Iterate over data keys to find matching user ID
        // Keys are format: "userId_channelId"
        for (const key in data) {
            if (key.startsWith(`${targetId}_`)) {
                delete data[key];
                deletedCount++;
            }
        }
        
        if (deletedCount > 0) {
            saveData();
            return message.reply(`✅ Historique DM réinitialisé pour **${targetUser.tag}** (${deletedCount} entrées supprimées).`);
        } else {
            return message.reply(`Aucun historique DM trouvé pour **${targetUser.tag}**.`);
        }

    } else if (command === 'config') {
        const action = args.shift()?.toLowerCase();

        if (!action) {
            return message.reply("Usage: `!config <add|del|set|list>`");
        }

        if (action === 'list') {
            if (config.configs.length === 0) {
                return message.reply("Aucune configuration active.");
            }
            const embed = new EmbedBuilder()
                .setTitle("Configurations Actives")
                .setColor(0x00FF00);
            
            config.configs.forEach((c, index) => {
                const dmStatus = c.dmAttachment ? "📸 Image configurée" : "❌ Pas d'image";
                const dmText = c.dmContent ? (c.dmContent.length > 50 ? c.dmContent.substring(0, 50) + '...' : c.dmContent) : "Aucun texte";
                
                embed.addFields({
                    name: `Config #${index + 1} | Salon: <#${c.channelId}>`,
                    value: `**Rôle :** <@&${c.roleId}>\n**DM Actif :** ${c.dmEnabled ? '✅' : '❌'}\n**Message DM :** ${dmText}\n**Cadeau DM :** ${dmStatus}`
                });
            });
            return message.reply({ embeds: [embed] });
        }

        if (action === 'add') {
            if (args.length < 2) return message.reply("Usage: `!config add <channel_id> <role_id>` (Vous pouvez attacher une image pour le DM)");
            const channelId = args[0].replace('<#', '').replace('>', '');
            const roleId = args[1].replace('<@&', '').replace('>', '');

            if (config.configs.find(c => c.channelId === channelId)) {
                return message.reply("Ce salon est déjà configuré. Utilisez `!config set` pour modifier.");
            }

            let dmAttachment = null;
            if (message.attachments.size > 0) {
                const attachment = message.attachments.first();
                const safeName = attachment.name || "dm_attachment";
                const filename = `${channelId}_dm_${Date.now()}_${safeName}`;
                try {
                    dmAttachment = await downloadAttachmentToLocal(attachment.url, filename);
                } catch (e) {
                    console.error("Error while caching DM attachment:", e);
                    return message.reply("Impossible d'enregistrer l'image du DM. Réessayez plus tard.");
                }
            }

            config.configs.push({
                channelId: channelId,
                roleId: roleId,
                buttonLabel: "Devenir Fan",
                promoTitle: "🔥 Contenu Exclusif",
                promoMessage: "Clique sur le bouton pour accéder au contenu !",
                dmContent: "Merci de ton soutien !",
                dmAttachment: dmAttachment,
                dmEnabled: true
            });
            saveConfig();
            return message.reply(`✅ Configuration ajoutée pour le salon <#${channelId}> avec le rôle <@&${roleId}>.${dmAttachment ? " (Image DM enregistrée 📸)" : ""}`);
        }

        if (action === 'del') {
            if (args.length < 1) return message.reply("Usage: `!config del <channel_id>`");
            const channelId = args[0].replace('<#', '').replace('>', '');

            const initialLength = config.configs.length;
            config.configs = config.configs.filter(c => c.channelId !== channelId);

            if (config.configs.length === initialLength) {
                return message.reply("Aucune configuration trouvée pour ce salon.");
            }
            saveConfig();
            return message.reply(`🗑️ Configuration supprimée pour le salon <#${channelId}>.`);
        }

        if (action === 'set') {
            if (args.length < 2) return message.reply("Usage: `!config set <channel> <msg|title|dm|btn|enabled|img|dm_img> <valeur>`");
            
            const channelId = args[0].replace('<#', '').replace('>', '');
            const key = args[1].toLowerCase();
            let value = args.slice(2).join(' ');

            const conf = config.configs.find(c => c.channelId === channelId);
            if (!conf) return message.reply("Configuration introuvable pour ce salon.");

            switch (key) {
                case 'msg': conf.promoMessage = value; break;
                case 'title': conf.promoTitle = value; break;
                case 'dm': conf.dmContent = value; break;
                case 'btn': conf.buttonLabel = value; break;
                case 'enabled': conf.dmEnabled = (value === 'true' || value === '1' || value === 'on'); break;
                case 'img':
                    if (message.attachments.size > 0) {
                        value = message.attachments.first().url;
                    }
                    if (!value) return message.reply("Veuillez fournir une URL ou attacher une image/vidéo.");
                    conf.promoAttachment = value;
                    break;
                case 'dm_img':
                    if (message.attachments.size > 0) {
                        const attachment = message.attachments.first();
                        const safeName = attachment.name || "dm_attachment";
                        const filename = `${channelId}_dm_${Date.now()}_${safeName}`;
                        try {
                            value = await downloadAttachmentToLocal(attachment.url, filename);
                        } catch (e) {
                            console.error("Error while caching DM attachment:", e);
                            return message.reply("Impossible d'enregistrer l'image du DM. Réessayez plus tard.");
                        }
                    }
                    if (!value) return message.reply("Veuillez fournir une URL ou attacher une image/vidéo pour le DM.");
                    conf.dmAttachment = value;
                    break;
                default: return message.reply("Clé invalide. Utilisez: msg, title, dm, btn, enabled, img, dm_img");
            }
            saveConfig();
            return message.reply(`✅ Configuration mise à jour pour <#${channelId}> (${key}).`);
        }
    } else if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle("🛠️ Aide & Commandes Admin")
            .setColor(0x0099FF)
            .setDescription("Voici la liste des commandes disponibles pour configurer le bot.")
            .addFields(
                { name: '📢 Promotion Automatique', value: 'Le bot réagit automatiquement aux messages dans les salons configurés.' },
                { name: '📨 DM de Masse', value: '`!dmall <RoleID> <Message>`\nEnvoie un DM à tous les membres ayant un rôle spécifique.\nOption: `--btn` pour ajouter le bouton "Devenir Fan".\n*Les membres/rôles blacklistés seront ignorés.*' },
                { name: '⚙️ Gestion des Configs', value: '`!config list` : Voir les configs actives\n`!config add <#Salon> <@Role>` : Ajouter une surveillance (Attachez une image pour le cadeau DM !)\n`!config del <#Salon>` : Supprimer une surveillance' },
                { name: '✏️ Modifier une Config', value: '`!config set <#Salon> <Option> <Valeur>`\n\n**Options :**\n`msg` : Message du salon (Utilisez `<nom d\'user>` pour le pseudo)\n`title` : Titre de l\'embed\n`dm` : Contenu du DM (Texte)\n`btn` : Texte du bouton\n`enabled` : Activer les DM (true/false)\n`img` : Image du message public\n`dm_img` : Image envoyée en DM (Cadeau)' },
                { name: '⛔ Blacklist', value: '`!blacklist list` : Voir la blacklist\n`!blacklist add <user|role> <id>` : Bloquer un user/rôle\n`!blacklist remove <user|role> <id>` : Débloquer' },
                { name: '🔄 Reset DM', value: '`!resetdm [@User]`\nRéinitialise l\'historique des DM pour vous ou un utilisateur spécifique (permet de recevoir le cadeau à nouveau).' }
            )
            .setFooter({ text: 'Bot Promotion - Admin Only' });

        return message.reply({ embeds: [embed] });
    }
}

client.login(process.env.DISCORD_TOKEN);
