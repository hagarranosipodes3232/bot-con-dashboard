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
app.get("/dashboard/:guildId/tickets", async (req, res) => {
  res.redirect(`/dashboard/${req.params.guildId}`);
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
  const ticketButtons = [];

  for (let i = 1; i <= 20; i++) {
    const label = body[`buttonLabel_${i}`];
    const emoji = body[`buttonEmoji_${i}`];
    const style = body[`buttonStyle_${i}`];
    const welcomeMessage = body[`buttonWelcome_${i}`];

    if (label || emoji || style || welcomeMessage) {
      ticketButtons.push({
        enabled: true,
        label: label || `Ticket ${i}`,
        emoji: emoji || "🎫",
        style: style || "Success",
        welcomeMessage: welcomeMessage || ""
      });
    }
  }

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
      ticketEmbedColor: body.ticketEmbedColor || "#23a559",
      ticketButtonLabel: body.ticketButtonLabel || "Abrir Ticket",
      ticketButtonEmoji: body.ticketButtonEmoji || "🎫",
      ticketButtonStyle: body.ticketButtonStyle || "Success",
      ticketButtons
    },
    { upsert: true, new: true, returnDocument: "after" }
  );
}

app.post("/dashboard/:guildId/tickets", async (req, res) => {
  await saveTicketConfig(req.params.guildId, req.body, false);
  res.redirect(`/dashboard/${req.params.guildId}`);
});
app.post("/dashboard/:guildId/tickets/send-panel", async (req, res) => {
  try {
    const guildId = req.params.guildId;
    const guild = client.guilds.cache.get(guildId);

    if (!guild) {
      return res.send("❌ El bot no está en este servidor.");
    }

    const config = await saveTicketConfig(guildId, req.body, true);

    const channel = guild.channels.cache.get(config.ticketPanelChannelId);

    if (!channel) {
      return res.send("❌ Seleccioná un canal del panel primero.");
    }

    const embed = new EmbedBuilder()
      .setAuthor({
        name: guild.name,
        iconURL: guild.iconURL() || undefined
      })
      .setTitle(config.ticketPanelName || "Panel de Tickets")
      .setDescription(config.ticketPanelMessage || "Abrí un ticket con los botones.")
      .setColor(config.ticketEmbedColor || "#23a559")
      .setFooter({ text: "Sistema de Tickets" })
      .setTimestamp();

    const styleMap = {
      Primary: ButtonStyle.Primary,
      Secondary: ButtonStyle.Secondary,
      Success: ButtonStyle.Success,
      Danger: ButtonStyle.Danger
    };

    const savedButtons = [];

    for (let i = 1; i <= 10; i++) {
      const label = req.body[`buttonLabel_${i}`];
      const emoji = req.body[`buttonEmoji_${i}`];
      const style = req.body[`buttonStyle_${i}`];
      const welcomeMessage = req.body[`buttonWelcome_${i}`];

      if (label || emoji || style || welcomeMessage) {

savedButtons.push({
  enabled: true,
  label: label || `Ticket ${i}`,
  emoji: emoji || "🎫",
  style: style || "Success",
  welcomeMessage: welcomeMessage || ""
});
             }
    }

    const buttons = savedButtons.length
      ? savedButtons.slice(0, 10)
      : [
          { label: "Abrir Ticket", emoji: "🎫", style: "Success", welcomeMessage: "" }
        ];

    const rows = [];

    for (let i = 0; i < buttons.length; i += 5) {
      const row = new ActionRowBuilder();

      buttons.slice(i, i + 5).forEach((btn, index) => {
        const realIndex = i + index;

        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`open_ticket_${realIndex}`)
            .setLabel(btn.label || `Ticket ${realIndex + 1}`)
            .setEmoji(btn.emoji || "🎫")
            .setStyle(styleMap[btn.style] || ButtonStyle.Success)
        );
      });

      rows.push(row);
    }

    await GuildConfig.findOneAndUpdate(
      { guildId },
      { ticketButtons: buttons },
      { new: true }
    );

    await channel.send({
      embeds: [embed],
      components: rows
    });

    return res.redirect(`/dashboard/${guildId}/tickets`);
  } catch (error) {
    console.log("❌ Error enviando panel:", error);
    return res.send("❌ Error enviando panel. Mirá los logs de Render.");
  }
});
   app.get("/invite", (req, res) => {
  const url =
    "https://discord.com/oauth2/authorize" +
    `?client_id=${process.env.CLIENT_ID}` +
    "&permissions=8" +
    "&scope=bot%20applications.commands";

  res.redirect(url);
});

function parseTopic(topic = "") {
  const data = {};

  topic.split(";").forEach(part => {
    const [key, value] = part.split("=");
    if (key && value) data[key] = value;
  });

  return data;
}

function replaceVars(text, interaction, channel) {
  return String(text || "")
    .replaceAll("{user}", `${interaction.user}`)
    .replaceAll("{user.id}", interaction.user.id)
    .replaceAll("{user.username}", interaction.user.username)
    .replaceAll("{server.name}", interaction.guild.name)
    .replaceAll("{channel.name}", channel.name);
}

async function sendLog(guild, config, embed, files = []) {
  if (!config?.ticketLogsChannelId) return;

  const logChannel = guild.channels.cache.get(config.ticketLogsChannelId);
  if (!logChannel) return;

  await logChannel.send({
    embeds: [embed],
    files
  }).catch(() => {});
}
client.on("interactionCreate", async interaction => {
  try {
    if (
      interaction.isButton() &&
      interaction.customId.startsWith("open_ticket_")
    ) {
      const config = await GuildConfig.findOne({
        guildId: interaction.guild.id
      });

      if (!config) {
        return interaction.reply({
          content: "❌ El sistema de tickets no está configurado.",
          ephemeral: true
        });
      }

      const buttonIndex = Number(
        interaction.customId.replace("open_ticket_", "")
      );

      const enabledButtons = config.ticketButtons?.length
        ? config.ticketButtons.filter(btn => btn.enabled)
        : [
            { label: "Consultas", emoji: "❓", style: "Primary", welcomeMessage: "" },
            { label: "Soporte", emoji: "🛠️", style: "Success", welcomeMessage: "" },
            { label: "Compras", emoji: "🛒", style: "Secondary", welcomeMessage: "" },
            { label: "Reportes", emoji: "🚨", style: "Danger", welcomeMessage: "" },
            { label: "Otros", emoji: "📩", style: "Primary", welcomeMessage: "" }
          ];

      console.log("BOTONES GUARDADOS:", config.ticketButtons);

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

console.log("BOTON SELECCIONADO:", selectedButton);
console.log("MENSAJE DEL BOTON:", selectedButton?.welcomeMessage);

     const welcomeRaw =
  selectedButton?.welcomeMessage ||
  "Hola {user}, gracias por abrir un ticket. Un miembro del staff te atenderá pronto.";

      const welcomeMessage = replaceVars(
        welcomeRaw,
        interaction,
        ticketChannel
      );

      const ticketEmbed = new EmbedBuilder()
        .setAuthor({
          name: interaction.user.username,
          iconURL: interaction.user.displayAvatarURL()
        })
        .setTitle(`🎫 Ticket abierto - ${selectedButton?.label || "Ticket"}`)
        .setDescription(welcomeMessage)
        .setColor(config.ticketEmbedColor || "#23a559")
        .addFields(
          { name: "👤 Usuario", value: `${interaction.user}`, inline: true },
          { name: "🆔 ID", value: `\`${interaction.user.id}\``, inline: true },
          { name: "📌 Estado", value: "Abierto", inline: true }
        )
        .setFooter({ text: "Sistema de Tickets" })
        .setTimestamp();

      const ticketButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("claim_ticket")
          .setLabel("Reclamar Ticket")
          .setEmoji("🙋")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("Cerrar Ticket")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({
        content: `${interaction.user}${staffId ? ` <@&${staffId}>` : ""}`,
        embeds: [ticketEmbed],
        components: [ticketButtons]
      });

      const logEmbed = new EmbedBuilder()
        .setTitle("🎫 Ticket creado")
        .setColor(config.ticketEmbedColor || "#23a559")
        .setDescription(
          `🎫 **Canal:** ${ticketChannel}\n` +
          `👤 **Usuario:** ${interaction.user}\n` +
          `🆔 **ID:** \`${interaction.user.id}\``
        )
        .setTimestamp();

      await sendLog(interaction.guild, config, logEmbed);

      return interaction.reply({
        content: `✅ Ticket creado: ${ticketChannel}`,
        ephemeral: true
      });
    }

    if (interaction.isButton() && interaction.customId === "claim_ticket") {
      const config = await GuildConfig.findOne({
        guildId: interaction.guild.id
      });

      const staffId = config?.supportRoleId || config?.staffRoleId;

      if (!staffId || !interaction.member.roles.cache.has(staffId)) {
        return interaction.reply({
          content: "❌ Solo el rango de soporte puede reclamar tickets.",
          ephemeral: true
        });
      }

      const topic = interaction.channel.topic || "";
      const data = parseTopic(topic);

      if (!data.owner) {
        return interaction.reply({
          content: "❌ Este canal no parece ser un ticket.",
          ephemeral: true
        });
      }

      if (data.claimed && data.claimed !== "none") {
        return interaction.reply({
          content: `❌ Este ticket ya fue reclamado por <@${data.claimed}>.`,
          ephemeral: true
        });
      }

      await interaction.channel.setTopic(
        topic.replace("claimed=none", `claimed=${interaction.user.id}`)
      );

      const embed = new EmbedBuilder()
        .setTitle("🙋 Ticket reclamado")
        .setColor(config.ticketEmbedColor || "#23a559")
        .setDescription(
          `👮 Staff asignado: ${interaction.user}\n\n` +
          `Este ticket ahora está siendo atendido.\n\n` +
          `Por favor espere una respuesta.`
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (interaction.isButton() && interaction.customId === "close_ticket") {
      const config = await GuildConfig.findOne({
        guildId: interaction.guild.id
      });

      const staffId = config?.supportRoleId || config?.staffRoleId;

      if (staffId && !interaction.member.roles.cache.has(staffId)) {
        return interaction.reply({
          content: "❌ Solo soporte puede cerrar tickets.",
          ephemeral: true
        });
      }

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

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "close_ticket_modal"
    ) {
      const config = await GuildConfig.findOne({
        guildId: interaction.guild.id
      });

      const reason = interaction.fields.getTextInputValue("close_reason");
      const data = parseTopic(interaction.channel.topic || "");

      if (!data.owner) {
        return interaction.reply({
          content: "❌ Este canal no parece ser un ticket.",
          ephemeral: true
        });
      }

      await interaction.reply({
        content: "🔒 Cerrando ticket y generando transcript...",
        ephemeral: true
      });

      const transcript = await discordTranscripts.createTranscript(
        interaction.channel,
        {
          limit: -1,
          returnType: "attachment",
          filename: `transcript-${interaction.channel.name}.html`
        }
      );

      const user = await client.users.fetch(data.owner).catch(() => null);

      const ratingRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("rating_excellent")
          .setLabel("Excelente")
          .setEmoji("⭐")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId("rating_good")
          .setLabel("Bueno")
          .setEmoji("👍")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("rating_bad")
          .setLabel("Mala")
          .setEmoji("👎")
          .setStyle(ButtonStyle.Danger)
      );

      const dmEmbed = new EmbedBuilder()
        .setTitle("📩 Tu ticket fue cerrado")
        .setColor(config?.ticketEmbedColor || "#23a559")
        .setDescription(
          `Tu ticket **${interaction.channel.name}** fue cerrado.\n\n` +
          `👮 **Cerrado por:** ${interaction.user}\n` +
          `📝 **Razón:** ${reason}\n\n` +
          `Adjuntamos el transcript completo. Abajo podés calificar la atención.`
        )
        .setTimestamp();

      if (user) {
        await user.send({
          embeds: [dmEmbed],
          files: [transcript],
          components: [ratingRow]
        }).catch(() => {});
      }

      const logEmbed = new EmbedBuilder()
        .setTitle("🔒 Ticket cerrado")
        .setColor(config?.ticketEmbedColor || "#23a559")
        .setDescription(
          `🎫 **Canal:** ${interaction.channel.name}\n` +
          `👤 **Usuario:** <@${data.owner}>\n` +
          `👮 **Cerrado por:** ${interaction.user}\n` +
          `📝 **Razón:**\n${reason}`
        )
        .setTimestamp();

      await sendLog(interaction.guild, config, logEmbed, [transcript]);

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 5000);

      return;
    }

    if (
      interaction.isButton() &&
      ["rating_excellent", "rating_good", "rating_bad"].includes(
        interaction.customId
      )
    ) {
      let rating = "Mala";
      let color = "#ed4245";

      if (interaction.customId === "rating_excellent") {
        rating = "Excelente";
        color = "#23a559";
      }

      if (interaction.customId === "rating_good") {
        rating = "Bueno";
        color = "#5865f2";
      }

      const embed = new EmbedBuilder()
        .setTitle("⭐ Gracias por tu calificación")
        .setColor(color)
        .setDescription(`Calificaste la atención como **${rating}**.`)
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
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
  console.log(`🤖 Bot conected como ${client.user.tag}`);
});

client.login(process.env.TOKEN);

app.listen(process.env.PORT || 3000, () => {
  console.log(`🌐 Dashboard online en puerto ${process.env.PORT || 3000}`);
});