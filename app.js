require("dotenv").config();

const express = require("express");
const session = require("express-session");
const axios = require("axios");
const mongoose = require("mongoose");

const GuildConfig = require("./models/GuildConfig");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField
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

app.get("/", (req, res) => {
  res.render("home");
});

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
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
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
      const ADMIN = 0x8n;
      const MANAGE_GUILD = 0x20n;
      return (perms & ADMIN) === ADMIN || (perms & MANAGE_GUILD) === MANAGE_GUILD;
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

  if (!config) {
    config = await GuildConfig.create({ guildId });
  }

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
  const guildId = req.params.guildId;

  await saveTicketConfig(guildId, req.body, false);

  res.redirect(`/dashboard/${guildId}`);
});

app.post("/dashboard/:guildId/tickets/send-panel", async (req, res) => {
  const guildId = req.params.guildId;
  const guild = client.guilds.cache.get(guildId);

  if (!guild) return res.send("❌ El bot no está en este servidor.");

  const canalId = req.body.ticketPanelChannelId;

  if (!canalId) {
    return res.send("❌ Seleccioná un canal del panel primero.");
  }

  const channel = guild.channels.cache.get(canalId);

  if (!channel) {
    return res.send("❌ El canal seleccionado no existe o el bot no lo puede ver.");
  }

  const config = await saveTicketConfig(guildId, req.body, true);

  const embed = new EmbedBuilder()
    .setTitle(req.body.ticketPanelName || config.ticketPanelName || "Panel de Tickets")
    .setDescription(req.body.ticketPanelMessage || config.ticketPanelMessage || "Usá el botón de abajo para abrir un ticket.")
    .setColor(req.body.ticketEmbedColor || config.ticketEmbedColor || "#23a559");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_ticket_general")
      .setLabel("Abrir Ticket")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Success)
  );

  await channel.send({
    embeds: [embed],
    components: [row]
  });

  res.redirect(`/dashboard/${guildId}`);
});

app.get("/invite", (req, res) => {
  const permissions = "8";

  const url =
    "https://discord.com/oauth2/authorize" +
    `?client_id=${process.env.CLIENT_ID}` +
    `&permissions=${permissions}` +
    "&scope=bot%20applications.commands";

  res.redirect(url);
});

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.isButton()) return;

    if (interaction.customId === "open_ticket_general") {
      const guildId = interaction.guild.id;
      const config = await GuildConfig.findOne({ guildId });

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

      const namePattern = config.ticketNamePattern || "ticket-{user.username}";

      const ticketName = namePattern
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
        topic: `owner=${interaction.user.id};status=open`,
        permissionOverwrites: overwrites
      });

      const welcomeRaw =
        config.ticketWelcomeMessage && config.ticketWelcomeMessage.trim().length > 0
          ? config.ticketWelcomeMessage
          : "Hola {user}, gracias por abrir un ticket. Un miembro del staff te atenderá pronto.";

      const welcomeMessage = welcomeRaw
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

    if (interaction.customId === "close_ticket") {
      await interaction.reply({
        content: "🔒 Cerrando ticket en 5 segundos...",
        ephemeral: true
      });

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 5000);
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

app.listen(3000, () => {
  console.log("🌐 Dashboard online en http://localhost:3000");
});