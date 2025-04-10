import { Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField, SlashCommandBuilder, REST, Routes, StringSelectMenuBuilder, ActionRowBuilder } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

// 📝 Customizable Bot Messages
const messages = {
  userConfirmation: '✅ Your message has been sent to the support team.',
  newTicketMessage: (userId, content, priority, category, time) => {
    return `Ticket created by <@${userId}>:

    **Issue**: ${content}
    **Category**: ${category}
    **Priority**: ${priority}
    **Time of Request**: ${time}`;
  },
  noPermission: '❌ You do not have permission.',
  claimSuccess: '✅ Ticket claimed and moved to your category.',
  closingTicket: '🗑️ Closing ticket...',
  claimedNotification: (staffName) => `📬 Your ticket has been claimed by ${staffName}! Hang tight — we’ll assist you shortly.`,
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const tickets = new Map(); // UserID -> ChannelID
let ticketCounter = 1;

client.once('ready', () => {
  console.log(`🟢 Logged in as ${client.user.tag}`);
  registerCommands();
});

// DM to Ticket: Dropdown Menu for Support Type
client.on('messageCreate', async message => {
  if (message.channel.type !== ChannelType.DM || message.author.bot) return;

  // Create dropdown menu
  const row = new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('support_type')
        .setPlaceholder('Select the type of support you need')
        .addOptions(
          { label: 'Technical Support', value: 'technical', emoji: '🛠️' },
          { label: 'General Questions', value: 'general', emoji: '💬' },
          { label: 'Other', value: 'other', emoji: '❓' }
        )
    );

  await message.reply({
    content: 'Please select the type of support you need:',
    components: [row]
  });
});

// Handle Dropdown Menu (Support Type)
client.on('interactionCreate', async interaction => {
  if (!interaction.isStringSelectMenu()) return;

  if (interaction.customId === 'support_type') {
    const { user, guild, values } = interaction;
    const selectedSupportType = values[0];

    let priority = 'Low';
    if (selectedSupportType === 'technical') priority = 'HIGH PRIORITY';
    if (selectedSupportType === 'general') priority = 'Medium';

    const category = selectedSupportType.charAt(0).toUpperCase() + selectedSupportType.slice(1); // Capitalize first letter

    const timeOfRequest = new Date().toLocaleString();

    const guildChannel = await client.guilds.fetch(process.env.GUILD_ID);
    const supportCategory = guildChannel.channels.cache.find(c => c.name === 'unclaimed-tickets' && c.type === ChannelType.GuildCategory)
      || await guildChannel.channels.create({
        name: 'unclaimed-tickets',
        type: ChannelType.GuildCategory
      });

    const ticketNumber = ticketCounter.toString().padStart(3, '0');
    ticketCounter++;

    const ticketChannel = await guildChannel.channels.create({
      name: `ticket-${ticketNumber}`,
      type: ChannelType.GuildText,
      parent: supportCategory.id,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: process.env.STAFF_ROLE, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: process.env.ADMIN_ROLE, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });

    tickets.set(user.id, ticketChannel.id);

    await ticketChannel.send({
      content: messages.newTicketMessage(user.id, interaction.message.content, priority, category, timeOfRequest)
    });

    await interaction.update({ content: '✅ Your ticket has been created!', components: [] });
  }
});

// Slash Commands for /claim and /close
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user, guild, channel } = interaction;

  const hasPermission = interaction.member.roles.cache.has(process.env.STAFF_ROLE)
    || interaction.member.roles.cache.has(process.env.ADMIN_ROLE)
    || interaction.user.id === process.env.ADMIN_ID;

  if (commandName === 'claim') {
    if (!hasPermission) {
      return interaction.reply({ content: messages.noPermission, ephemeral: true });
    }

    const staffCategoryName = `claimed-${user.username.toLowerCase()}`;
    let category = guild.channels.cache.find(c => c.name === staffCategoryName && c.type === ChannelType.GuildCategory);

    if (!category) {
      category = await guild.channels.create({
        name: staffCategoryName,
        type: ChannelType.GuildCategory
      });
    }

    await channel.setParent(category.id);
    await interaction.reply(messages.claimSuccess);

    // Notify the user
    const ticketCreatorId = tickets.get(user.id);
    const ticketCreator = await client.users.fetch(ticketCreatorId);
    ticketCreator.send(messages.claimedNotification(user.username));
  }

  if (commandName === 'close') {
    if (!hasPermission) {
      return interaction.reply({ content: messages.noPermission, ephemeral: true });
    }

    await interaction.reply(messages.closingTicket);
    setTimeout(() => channel.delete(), 3000);
  }
});

// Slash Command Registration
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName('claim').setDescription('Claim this ticket.'),
    new SlashCommandBuilder().setName('close').setDescription('Close this ticket.')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: commands });

  console.log('✅ Slash commands registered.');
}

client.login(process.env.TOKEN);
