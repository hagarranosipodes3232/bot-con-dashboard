require("dotenv").config();

const express = require("express");
const session = require("express-session");
const axios = require("axios");
const mongoose = require("mongoose");
const discordTranscripts = require("discord-html-transcripts");

const GuildConfig = require("./models/GuildConfig");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const app = express();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(console.error);

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "012_secret",
  resave: false,
  saveUninitialized: false
}));

app.get("/", (req, res) => res.render("home"));

app.get("/login", (req, res) => {
  const url =
    "https://discord.com/oauth2/authorize" +
    `?client_id=${process.env.CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.BASE_URL + "/callback")}` +
    "&response_type=code" +
    "&scope=identify%20guilds";

  res.redirect(url);
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("❌ No llegó el código de Discord.");

  try {
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.BASE_URL + "/callback"
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    req.session.access_token = tokenRes.data.access_token;
    res.redirect("/servers");
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.send("❌ Error iniciando sesión con Discord.");
  }
});

app.get("/servers", async (req, res) => {
  if (!req.session.access_token) return res.redirect("/login");

  try {
    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${req.session.access_token}` }
    });

    const guildsRes = await axios.get("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${req.session.access_token}` }
    });

    const guilds = guildsRes.data.filter(guild => {
      const perms = BigInt(guild.permissions);
      return (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
    });

    res.render("servers", {
      user: userRes.data,
      guilds,
      botGuilds: client.guilds.cache.map(g => g.id)
    });
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.send("❌ Error cargando servidores.");
  }
});

app.get("/dashboard/:guildId", async (req, res) => {
  if (!req.session.access_token) return res.redirect("/login");

  const guildId = req.params.guildId;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.send("❌ El bot no está en este servidor.");

  let config = await GuildConfig.findOne({ guildId });
  if (!config) config = await GuildConfig.create({ guildId });

  const categories = guild.channels.cache
    .filter(ch => ch.type === ChannelType.GuildCategory)
    .map(ch => ({ id: ch.id, name: ch.name }));

  const textChannels = guild.channels.cache
    .filter(ch => ch.type === ChannelType.GuildText)
    .map(ch => ({ id: ch.id, name: ch.name }));

  const roles = guild.roles.cache
    .filter(role => role.name !== "@everyone")
    .map(role => ({ id: role.id, name: role.name }));

  res.render("dashboard", {
    guild,
    config,
    categories,
    textChannels,
    roles
  });
});

async function saveTicketConfig(guildId, body, forceEnabled = false) {
  return GuildConfig.findOneAndUpdate(
    { guildId },
    {
      ticketsEnabled: forceEnabled ? true : body.ticketsEnabled === "on",
      ticketCategoryId: body.ticketCategoryId || "",
      staffRoleId: body.staffRoleId || "",
      ticketLogsChannelId: body.ticketLogsChannelId || "",
      ticketPanelName: body.ticketPanelName || "Panel de Tickets",
      ticketPanelChannelId: body.ticketPanelChannelId || "",
      supportRoleId: body.supportRoleId || "",
      ticketNamePattern: body.ticketNamePattern || "ticket-{user.username}",
      ticketLimit: Number(body.ticketLimit || 1),
      ticketWelcomeMessage:
        body.ticketWelcomeMessage && body.ticketWelcomeMessage.trim() !== ""
          ? body.ticketWelcomeMessage
          : "Hola {user}, gracias por abrir un ticket. Un miembro del staff te atenderá pronto.",
      ticketPanelMessage:
        body.ticketPanelMessage && body.ticketPanelMessage.trim() !== ""
          ? body.ticketPanelMessage
          : "Usá el botón de abajo para abrir un ticket.",
      ticketEmbedColor: body.ticketEmbedColor || "#23a559"
    },
    { upsert: true, new: true }
  );
}

app.post("/dashboard/:guildId/tickets", async (req, res) => {
  await saveTicketConfig(req.params.guildId, req.body, false);
  res.redirect(`/dashboard/${req.params.guildId}`);
});

app.post("/dashboard/:guildId/tickets/send-panel", async (req, res) => {
  const guildId = req.params.guildId;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.send("❌ El bot no está en este servidor.");

  const channel = guild.channels.cache.get(req.body.ticketPanelChannelId);
  if (!channel) return res.send("❌ Seleccioná un canal del panel primero.");

  const config = await saveTicketConfig(guildId, req.body, true);

  const embed = new EmbedBuilder()
    .setTitle(req.body.ticketPanelName || config.ticketPanelName || "Panel de Tickets")
    .setDescription(req.body.ticketPanelMessage || config.ticketPanelMessage)
    .setColor(req.body.ticketEmbedColor || config.ticketEmbedColor || "#23a559");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_ticket_general")
      .setLabel("Abrir Ticket")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Success)
  );

  await channel.send({ embeds: [embed], components: [row] });
  res.redirect(`/dashboard/${guildId}`);
});

app.get("/invite", (req, res) => {
  const url =
    "https://discord.com/oauth2/authorize" +
    `?client_id=${process.env.CLIENT_ID}` +
    "&permissions=8" +
    "&scope=bot%20applications.commands";

  res.redirect(url);
});

function getOwnerIdFromTopic(topic) {
  return topic?.match(/owner=(\d+)/)?.[1] || null;
}

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton() && interaction.customId === "open_ticket_general") {
      const config = await GuildConfig.findOne({ guildId: interaction.guild.id });

      if (!config || !config.ticketsEnabled) {
        return interaction.reply({
          content: "❌ El sistema de tickets no está configurado.",
          ephemeral: true
        });
      }

      const existing = interaction.guild.channels.cache.find(ch =>
        ch.topic &&
        ch.topic.includes(`owner=${interaction.user.id}`) &&
        ch.topic.includes("status=open")
      );

      if (existing) {
        return interaction.reply({
          content: `❌ Ya tenés un ticket abierto: ${existing}`,
          ephemeral: true
        });
      }

      const ticketName = (config.ticketNamePattern || "ticket-{user.username}")
        .replaceAll("{number}", Date.now().toString().slice(-5))
        .replaceAll("{user.username}", interaction.user.username)
        .replaceAll("{user}", interaction.user.username)
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-");

      const staffId = config.supportRoleId || config.staffRoleId || "";

      const overwrites = [
        {
          id: interaction.guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        }
      ];

      if (staffId) {
        overwrites.push({
          id: staffId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageChannels
          ]
        });
      }

      const ticketChannel = await interaction.guild.channels.create({
        name: ticketName,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId || null,
        topic: `owner=${interaction.user.id};status=open;claimed=none`,
        permissionOverwrites: overwrites
      });

      const welcomeMessage = (config.ticketWelcomeMessage ||
        "Hola {user}, gracias por abrir un ticket. Un miembro del staff te atenderá pronto.")
        .replaceAll("{user}", `${interaction.user}`)
        .replaceAll("{user.id}", interaction.user.id)
        .replaceAll("{user.username}", interaction.user.username)
        .replaceAll("{server.name}", interaction.guild.name)
        .replaceAll("{channel.name}", ticketChannel.name);

      const ticketEmbed = new EmbedBuilder()
        .setTitle(`Ticket de ${interaction.user.username}`)
        .setDescription(welcomeMessage)
        .setColor(config.ticketEmbedColor || "#23a559")
        .setTimestamp();

      const ticketButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("claim_ticket")
          .setLabel("Reclamar Ticket")
          .setEmoji("🙋")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("Cerrar")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({
        content: `${interaction.user}${staffId ? ` <@&${staffId}>` : ""}`,
        embeds: [ticketEmbed],
        components: [ticketButtons]
      });

      return interaction.reply({
        content: `✅ Ticket creado: ${ticketChannel}`,
        ephemeral: true
      });
    }

    if (interaction.isButton() && interaction.customId === "claim_ticket") {
      const config = await GuildConfig.findOne({ guildId: interaction.guild.id });
      const staffId = config?.supportRoleId || config?.staffRoleId;

      if (!staffId || !interaction.member.roles.cache.has(staffId)) {
        return interaction.reply({
          content: "❌ Solo el rango de soporte puede reclamar tickets.",
          ephemeral: true
        });
      }

      const topic = interaction.channel.topic || "";

      if (topic.includes("claimed=") && !topic.includes("claimed=none")) {
        return interaction.reply({
          content: "❌ Este ticket ya fue reclamado.",
          ephemeral: true
        });
      }

      await interaction.channel.setTopic(
        topic.replace("claimed=none", `claimed=${interaction.user.id}`)
      );

      return interaction.reply({
        content: `🙋 Ticket reclamado por ${interaction.user}.`
      });
    }

    if (interaction.isButton() && interaction.customId === "close_ticket") {
      const modal = new ModalBuilder()
        .setCustomId("close_ticket_modal")
        .setTitle("Cerrar ticket");

      const reasonInput = new TextInputBuilder()
        .setCustomId("close_reason")
        .setLabel("Razón del cierre")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder("Ejemplo: problema resuelto, compra finalizada...");

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === "close_ticket_modal") {
      const reason = interaction.fields.getTextInputValue("close_reason");
      const ownerId = getOwnerIdFromTopic(interaction.channel.topic);
      const user = ownerId ? await client.users.fetch(ownerId).catch(() => null) : null;

      await interaction.reply({
        content: "🔒 Cerrando ticket y generando transcript...",
        ephemeral: true
      });

      const transcript = await discordTranscripts.createTranscript(interaction.channel, {
        limit: -1,
        returnType: "attachment",
        filename: `transcript-${interaction.channel.name}.html`
      });

      const ratingRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("rating_excellent")
          .setLabel("Excelente")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId("rating_good")
          .setLabel("Bueno")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("rating_bad")
          .setLabel("Mala")
          .setStyle(ButtonStyle.Danger)
      );

      if (user) {
        await user.send({
          content:
            `📩 Tu ticket **${interaction.channel.name}** fue cerrado.\n\n` +
            `📝 **Razón:** ${reason}\n` +
            `👤 **Cerrado por:** ${interaction.user}\n\n` +
            `Adjuntamos el transcript del ticket. Abajo podés calificar la atención.`,
          files: [transcript],
          components: [ratingRow]
        }).catch(() => {});
      }

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 5000);

      return;
    }

    if (
      interaction.isButton() &&
      ["rating_excellent", "rating_good", "rating_bad"].includes(interaction.customId)
    ) {
      let rating = "Mala";
      if (interaction.customId === "rating_excellent") rating = "Excelente";
      if (interaction.customId === "rating_good") rating = "Bueno";

      return interaction.reply({
        content: `✅ Gracias por calificar la atención como **${rating}**.`,
        ephemeral: true
      });
    }

  } catch (error) {
    console.log("❌ Error interactionCreate:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Ocurrió un error.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

client.once("clientReady", () => {
  console.log(`🤖 Bot conectado como ${client.user.tag}`);
});

client.login(process.env.TOKEN);

app.listen(process.env.PORT || 3000, () => {
  console.log(`🌐 Dashboard online en puerto ${process.env.PORT || 3000}`);
});