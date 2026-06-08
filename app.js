require("dotenv").config();

const express = require("express");
const session = require("express-session");
const axios = require("axios");
const mongoose = require("mongoose");
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage()
});
const discordTranscripts = require("discord-html-transcripts");

const GuildConfig = require("./models/GuildConfig");
const BotLog = require("./models/BotLog");

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
  intents: [
    GatewayIntentBits.Guilds
  ]
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

  if (!code) {
    return res.send("❌ No llegó el código de Discord.");
  }

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
  if (!req.session.access_token) {
    return res.redirect("/login");
  }

  try {
    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `Bearer ${req.session.access_token}`
      }
    });

    const guildsRes = await axios.get("https://discord.com/api/users/@me/guilds", {
      headers: {
        Authorization: `Bearer ${req.session.access_token}`
      }
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
  if (!req.session.access_token) {
    return res.redirect("/login");
  }

  const guildId = req.params.guildId;
  const guild = client.guilds.cache.get(guildId);

  if (!guild) {
    return res.send("❌ El bot no está en este servidor.");
  }

  let config = await GuildConfig.findOne({ guildId });

  if (!config) {
    config = await GuildConfig.create({ guildId });
  }

  const categories = guild.channels.cache
    .filter(ch => ch.type === ChannelType.GuildCategory)
    .map(ch => ({
      id: ch.id,
      name: ch.name
    }));

  const textChannels = guild.channels.cache
    .filter(ch => ch.type === ChannelType.GuildText)
    .map(ch => ({
      id: ch.id,
      name: ch.name
    }));

  const roles = guild.roles.cache
    .filter(role => role.name !== "@everyone")
    .map(role => ({
      id: role.id,
      name: role.name
    }));

  res.render("dashboard", {
    guild,
    config,
    categories,
    textChannels,
    roles
  });
});
app.get("/dashboard/:guildId/logs", async (req, res) => {
  if (!req.session.access_token) {
    return res.redirect("/login");
  }

  const guildId = req.params.guildId;
  const guild = client.guilds.cache.get(guildId);

  if (!guild) {
    return res.send("❌ El bot no está en este servidor.");
  }

  const logs = await BotLog.find({ guildId })
    .sort({ createdAt: -1 })
    .limit(100);

  const stats = {
    total: await BotLog.countDocuments({ guildId }),
    ticketsCreated: await BotLog.countDocuments({ guildId, type: "ticket_created" }),
    ticketsClosed: await BotLog.countDocuments({ guildId, type: "ticket_closed" }),
    verifications: await BotLog.countDocuments({ guildId, type: "verification" })
  };
let config = await GuildConfig.findOne({ guildId });

if (!config) {
  config = await GuildConfig.create({ guildId });
}
  res.render("logs", {
    guild,
  config,
    logs,
    stats
  });
});
app.get("/dashboard/:guildId/backup/export", async (req, res) => {
  const guildId = req.params.guildId;

  const config = await GuildConfig.findOne({ guildId });

  if (!config) {
    return res.send("❌ No hay configuración para exportar.");
  }

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=backup-${guildId}.json`
  );

  res.setHeader("Content-Type", "application/json");

  res.send(JSON.stringify(config, null, 2));
});

app.get("/dashboard/:guildId/backup/reset", async (req, res) => {
  const guildId = req.params.guildId;

  await GuildConfig.findOneAndDelete({ guildId });
  await GuildConfig.create({ guildId });

  res.redirect(`/dashboard/${guildId}/configuration`);
});
app.post("/dashboard/:guildId/backup/import", upload.single("backupFile"), async (req, res) => {
  try {
    const guildId = req.params.guildId;

    if (!req.file) {
      return res.send("❌ No subiste ningún archivo.");
    }

    const jsonText = req.file.buffer.toString("utf8");
    const backupData = JSON.parse(jsonText);

    delete backupData._id;
    delete backupData.__v;
    delete backupData.createdAt;
    delete backupData.updatedAt;

    backupData.guildId = guildId;

    await GuildConfig.findOneAndUpdate(
      { guildId },
      backupData,
      { upsert: true, new: true }
    );

    res.redirect(`/dashboard/${guildId}/configuration`);
  } catch (error) {
    console.log("❌ Error importando backup:", error);
    res.status(500).send("❌ Error importando backup.");
  }
});
app.get("/dashboard/:guildId/backup/export", async (req, res) => {
  const guildId = req.params.guildId;

  const config = await GuildConfig.findOne({ guildId });

  if (!config) {
    return res.send("❌ No hay configuración.");
  }

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=backup-${guildId}.json`
  );

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  res.send(JSON.stringify(config, null, 2));
});

app.get("/dashboard/:guildId/backup/reset", async (req, res) => {
  const guildId = req.params.guildId;

  await GuildConfig.findOneAndDelete({ guildId });
  await GuildConfig.create({ guildId });

  res.redirect(`/dashboard/${guildId}/configuration`);
});

app.post(
  "/dashboard/:guildId/backup/import",
  upload.single("backupFile"),
  async (req, res) => {

    const guildId = req.params.guildId;

    if (!req.file) {
      return res.send("❌ No subiste archivo.");
    }

    const backupData = JSON.parse(
      req.file.buffer.toString("utf8")
    );

    delete backupData._id;
    delete backupData.__v;
    delete backupData.createdAt;
    delete backupData.updatedAt;

    backupData.guildId = guildId;

    await GuildConfig.findOneAndUpdate(
      { guildId },
      backupData,
      { upsert: true }
    );

    res.redirect(`/dashboard/${guildId}/configuration`);
  }
);
app.get("/dashboard/:guildId/configuration", async (req, res) => {
  if (!req.session.access_token) {
    return res.redirect("/login");
  }

  const guildId = req.params.guildId;
  const guild = client.guilds.cache.get(guildId);

  if (!guild) {
    return res.send("❌ El bot no está en este servidor.");
  }

  let config = await GuildConfig.findOne({ guildId });

  if (!config) {
    config = await GuildConfig.create({ guildId });
  }

  res.render("configuration", {
    guild,
    config
  });
});
app.get("/dashboard/:guildId/stats", async (req, res) => {
  if (!req.session.access_token) {
    return res.redirect("/login");
  }

  const guildId = req.params.guildId;
  const guild = client.guilds.cache.get(guildId);

  if (!guild) {
    return res.send("❌ El bot no está en este servidor.");
  }

  let config = await GuildConfig.findOne({ guildId });

  if (!config) {
    config = await GuildConfig.create({ guildId });
  }

const uptimeSeconds = process.uptime();

const days = Math.floor(uptimeSeconds / 86400);
const hours = Math.floor((uptimeSeconds % 86400) / 3600);
const minutes = Math.floor((uptimeSeconds % 3600) / 60);

const stats = {
  members: guild.memberCount || 0,

  ping: client.ws.ping,

  ram: (
    process.memoryUsage().heapUsed /
    1024 /
    1024
  ).toFixed(0),

  uptime: `${days}d ${hours}h ${minutes}m`
};
  res.render("stats", {
    guild,
    config,
    stats
  });
});
app.post("/dashboard/:guildId/configuration", async (req, res) => {
  const guildId = req.params.guildId;

  const updateData = {};

  if (req.body.dashboardThemeColor !== undefined) {
    updateData.dashboardThemeColor = req.body.dashboardThemeColor || "#7c3aed";
    updateData.dashboardAnimations = req.body.dashboardAnimations === "on";
    updateData.dashboardParticles = req.body.dashboardParticles === "on";
    updateData.dashboardGlass = req.body.dashboardGlass === "on";
  }

  if (req.body.securityForm === "1") {
    updateData.securityAntiVPN = req.body.securityAntiVPN === "on";
    updateData.securityAntiProxy = req.body.securityAntiProxy === "on";
    updateData.securityAntiNewAccounts = req.body.securityAntiNewAccounts === "on";
  }

  await GuildConfig.findOneAndUpdate(
    { guildId },
    updateData,
    { upsert: true, new: true }
  );

  res.redirect(`/dashboard/${guildId}/configuration`);
});
function buildTicketButtonsFromBody(body) {
  const ticketButtons = [];

  for (let i = 1; i <= 10; i++) {
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

  if (ticketButtons.length === 0) {
    ticketButtons.push({
      enabled: true,
      label: "Abrir Ticket",
      emoji: "🎫",
      style: "Success",
      welcomeMessage: ""
    });
  }

  return ticketButtons;
}

async function saveTicketConfig(guildId, body, forceEnabled = false) {
  const ticketButtons = buildTicketButtonsFromBody(body);

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
          : "Abrí un ticket con los botones.",

      ticketEmbedColor: body.ticketEmbedColor || "#23a559",
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

    const buttons = (config.ticketButtons || [])
      .filter(btn => btn.enabled !== false)
      .slice(0, 10);

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

    console.log("BOTONES GUARDADOS:", buttons);
    console.log("ROWS CREADAS:", rows.length);

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
app.get("/dashboard/:guildId/verification", async (req, res) => {
  if (!req.session.access_token) return res.redirect("/login");

  const guildId = req.params.guildId;
  const guild = client.guilds.cache.get(guildId);

  if (!guild) return res.send("❌ El bot no está en este servidor.");

  let config = await GuildConfig.findOne({ guildId });
  if (!config) config = await GuildConfig.create({ guildId });

  const textChannels = guild.channels.cache
    .filter(ch => ch.type === ChannelType.GuildText)
    .map(ch => ({ id: ch.id, name: ch.name }));

  const roles = guild.roles.cache
    .filter(role => role.name !== "@everyone")
    .map(role => ({ id: role.id, name: role.name }));

  res.render("verification", {
    guild,
    config,
    textChannels,
    roles
  });
});
async function saveVerificationConfig(guildId, body) {
  return GuildConfig.findOneAndUpdate(
    { guildId },
    {
      verificationEnabled: true,
      verificationPanelChannelId: body.verificationPanelChannelId || "",
      verificationRoleId: body.verificationRoleId || "",
      verificationLogsChannelId: body.verificationLogsChannelId || "",
      verificationEmbedTitle: body.verificationEmbedTitle || "✅ Verificación",
      verificationEmbedMessage: body.verificationEmbedMessage || "Presioná el botón para verificarte.",
      verificationEmbedColor: body.verificationEmbedColor || "#23a559",

      verificationShowCity: body.verificationShowCity === "on",
      verificationShowRegion: body.verificationShowRegion === "on",
      verificationShowCountry: body.verificationShowCountry === "on",
      verificationShowISP: body.verificationShowISP === "on",
      verificationShowVPN: body.verificationShowVPN === "on",
      verificationShowMaskedIP: body.verificationShowMaskedIP === "on",
      verificationShowAccountCreated: body.verificationShowAccountCreated === "on",

      verificationShowGlobalName: body.verificationShowGlobalName === "on",
      verificationShowUsername: body.verificationShowUsername === "on",
      verificationShowUserId: body.verificationShowUserId === "on",
      verificationShowBigAvatar: body.verificationShowBigAvatar === "on",
      verificationShowAccountAge: body.verificationShowAccountAge === "on",
      verificationShowNitro: body.verificationShowNitro === "on",
      verificationShowAvatarType: body.verificationShowAvatarType === "on",

      verificationShowCountryCode: body.verificationShowCountryCode === "on",
      verificationShowTimezone: body.verificationShowTimezone === "on",
      verificationShowASN: body.verificationShowASN === "on",
      verificationShowHosting: body.verificationShowHosting === "on",
      verificationShowProxy: body.verificationShowProxy === "on",
      verificationShowMobile: body.verificationShowMobile === "on",

      verificationShowVerifyDate: body.verificationShowVerifyDate === "on",
      verificationShowVerifyDuration: body.verificationShowVerifyDuration === "on",
      verificationShowRoleGiven: body.verificationShowRoleGiven === "on",
      verificationShowVerifyChannel: body.verificationShowVerifyChannel === "on",
      verificationShowTotalVerifications: body.verificationShowTotalVerifications === "on",
      verificationShowAttempts: body.verificationShowAttempts === "on",

      verificationShowSecurityAlerts: body.verificationShowSecurityAlerts === "on",
      verificationShowRisk: body.verificationShowRisk === "on",

      verificationShowUserThumbnail: body.verificationShowUserThumbnail === "on",
      verificationShowUserBanner: body.verificationShowUserBanner === "on",
      verificationShowProfileButton: body.verificationShowProfileButton === "on",
      verificationShowCopyIdButton: body.verificationShowCopyIdButton === "on"
    },
    { upsert: true, new: true, returnDocument: "after" }
  );
}

app.post("/dashboard/:guildId/verification", async (req, res) => {
  await saveVerificationConfig(req.params.guildId, req.body);
  res.redirect(`/dashboard/${req.params.guildId}/verification`);
});

app.post("/dashboard/:guildId/verification/send-panel", async (req, res) => {
  try {
    const guildId = req.params.guildId;
    const guild = client.guilds.cache.get(guildId);

    if (!guild) return res.send("❌ El bot no está en este servidor.");

    const config = await saveVerificationConfig(guildId, req.body);

    const channel = guild.channels.cache.get(config.verificationPanelChannelId);
    if (!channel) return res.send("❌ Seleccioná un canal del panel primero.");

    const embed = new EmbedBuilder()
      .setTitle(config.verificationEmbedTitle || "✅ Verificación")
      .setDescription(config.verificationEmbedMessage || "Presioná el botón para verificarte.")
      .setColor(config.verificationEmbedColor || "#23a559")
      .setFooter({ text: "Sistema de Verificación" })
      .setTimestamp();

    const verifyUrl = `${process.env.BASE_URL}/verify/${guildId}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("✅ Verificarme")
        .setStyle(ButtonStyle.Link)
        .setURL(verifyUrl)
    );

    await channel.send({
      embeds: [embed],
      components: [row]
    });

    return res.redirect(`/dashboard/${guildId}/verification`);
  } catch (error) {
    console.log("❌ Error enviando panel de verificación:", error);
    return res.send("❌ Error enviando panel de verificación.");
  }
});
// =========================
// VERIFICACION WEB
// =========================

function maskIP(ip = "") {
  if (!ip) return "No disponible";

  if (ip.includes(".")) {
    const parts = ip.split(".");
    return `${parts[0]}.xxx.xxx.${parts[3] || "x"}`;
  }

  return ip.slice(0, 6) + "..." + ip.slice(-4);
}

function getClientIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();

  return req.socket.remoteAddress || "";
}

app.get("/verify/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const guildId = req.query.state;

    if (!code || !guildId) {
      return res.send("❌ Faltan datos de verificación.");
    }

    const config = await GuildConfig.findOne({ guildId });
    if (!config) return res.send("❌ Este servidor no tiene verificación configurada.");

    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
     redirect_uri: "https://bot-con-dashboard.onrender.com/verify/callback"
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const userRes = await axios.get("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `Bearer ${tokenRes.data.access_token}`
      }
    });

    const user = userRes.data;
    const guild = client.guilds.cache.get(guildId);

    if (!guild) return res.send("❌ El bot no está en este servidor.");

    const member = await guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return res.send("❌ Tenés que estar dentro del servidor para verificarte.");
    }

      const ip = getClientIP(req);
const geo = await axios
.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,as,proxy,hosting,mobile,timezone,query`)
  .then(r => r.data)
  .catch(() => null);

 const fields = [];

const createdAt = new Date(Number((BigInt(user.id) >> 22n) + 1420070400000n));
const accountAgeDays = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
if (config.securityAntiNewAccounts && accountAgeDays < 7) {
  return res.send("❌ Tu cuenta de Discord es demasiado nueva para verificarte.");
}

if (config.securityAntiProxy && geo?.proxy) {
  return res.send("❌ No podés verificarte usando proxy.");
}

if (config.securityAntiVPN && (geo?.proxy || geo?.hosting)) {
  return res.send("❌ No podés verificarte usando VPN o hosting.");
}

if (config.verificationRoleId) {
  await member.roles.add(config.verificationRoleId).catch(console.error);
}

let risk = "🟢 Bajo";
const alerts = [];

if (accountAgeDays < 7) {
  risk = "🔴 Alto";
  alerts.push("Cuenta creada hace menos de 7 días");
} else if (accountAgeDays < 30) {
  risk = "🟡 Medio";
  alerts.push("Cuenta creada hace menos de 30 días");
}

if (geo?.proxy) alerts.push("Proxy detectado");
if (geo?.hosting) alerts.push("Hosting detectado");

if (config.verificationShowGlobalName) {
  fields.push({ name: "👤 Nombre global", value: user.global_name || "No disponible", inline: true });
}

if (config.verificationShowUsername) {
  fields.push({ name: "🏷️ Username", value: `@${user.username}`, inline: true });
}

if (config.verificationShowUserId) {
  fields.push({ name: "🆔 ID", value: `\`${user.id}\``, inline: true });
}

if (config.verificationShowAvatarType) {
  fields.push({
    name: "🖼️ Avatar",
    value: user.avatar ? "Personalizado" : "Por defecto",
    inline: true
  });
}

if (config.verificationShowMaskedIP) {
  fields.push({ name: "🌐 IP", value: `\`${maskIP(ip)}\``, inline: true });
}

if (geo?.status === "success") {
  if (config.verificationShowCity) fields.push({ name: "🏙️ Ciudad", value: geo.city || "No disponible", inline: true });
  if (config.verificationShowRegion) fields.push({ name: "📍 Región", value: geo.regionName || "No disponible", inline: true });
  if (config.verificationShowCountry) fields.push({ name: "🌎 País", value: geo.country || "No disponible", inline: true });
  if (config.verificationShowCountryCode) fields.push({ name: "🏳️ Código país", value: geo.countryCode || "No disponible", inline: true });
  if (config.verificationShowTimezone) fields.push({ name: "🕒 Zona horaria", value: geo.timezone || "No disponible", inline: true });
  if (config.verificationShowISP) fields.push({ name: "📡 ISP", value: geo.isp || "No disponible", inline: true });
  if (config.verificationShowASN) fields.push({ name: "🏢 ASN", value: geo.as || "No disponible", inline: true });

  if (config.verificationShowVPN) {
    fields.push({ name: "🛡️ VPN", value: geo.proxy ? "Posible VPN/Proxy" : "No detectado", inline: true });
  }

  if (config.verificationShowProxy) {
    fields.push({ name: "🔄 Proxy", value: geo.proxy ? "Detectado" : "No detectado", inline: true });
  }

  if (config.verificationShowHosting) {
    fields.push({ name: "🖥️ Hosting", value: geo.hosting ? "Detectado" : "No detectado", inline: true });
  }

  if (config.verificationShowMobile) {
    fields.push({ name: "📱 Mobile", value: geo.mobile ? "Sí" : "No / desconocido", inline: true });
  }
}

if (config.verificationShowAccountCreated) {
  fields.push({
    name: "📅 Cuenta creada",
    value: `<t:${Math.floor(createdAt.getTime() / 1000)}:F>`,
    inline: false
  });
}

if (config.verificationShowAccountAge) {
  fields.push({ name: "⏳ Edad de cuenta", value: `${accountAgeDays} días`, inline: true });
}

if (config.verificationShowNitro) {
  fields.push({ name: "💎 Nitro", value: user.premium_type ? "Posible Nitro" : "No detectable / No", inline: true });
}

if (config.verificationShowVerifyDate) {
  fields.push({ name: "✅ Verificado", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false });
}

if (config.verificationShowRoleGiven) {
  fields.push({
    name: "🎖️ Rol entregado",
    value: config.verificationRoleId ? `<@&${config.verificationRoleId}>` : "No configurado",
    inline: true
  });
}

if (config.verificationShowRisk) {
  fields.push({ name: "⚠️ Riesgo", value: risk, inline: true });
}

if (config.verificationShowSecurityAlerts) {
  fields.push({
    name: "🛡️ Alertas",
    value: alerts.length ? alerts.join("\n") : "Sin alertas",
    inline: false
  });
}

const logEmbed = new EmbedBuilder()
  .setTitle("✅ Usuario verificado")
  .setColor(config.verificationEmbedColor || "#23a559")
  .setThumbnail(
    user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : null
  )
  .addFields(fields)
  .setTimestamp();
const logChannel = guild.channels.cache.get(config.verificationLogsChannelId);

if (logChannel) {
  await logChannel.send({ embeds: [logEmbed] }).catch(console.error);
}

return res.send(`
<html>
<body style="background:#020617;color:white;font-family:Arial;text-align:center;padding-top:100px;">
  <h1>✅ Verificación completada</h1>
  <p>Ya fuiste verificado correctamente en el servidor.</p>
</body>
</html>
`);
} catch (error) {
  console.log("❌ Error verify callback:", error.response?.data || error);
  return res.send("❌ Error al completar la verificación.");
}
});
app.get("/verify/:guildId", async (req, res) => {
  const guildId = req.params.guildId;

  res.send(`
    <html>
    <head>
      <title>Verificación</title>
    </head>
    <body style="background:#0f172a;color:white;font-family:Arial;text-align:center;padding-top:100px;">
      <h1>✅ Verificación</h1>
      <p>Para verificarte en el servidor continuá con Discord.</p>

      <a href="/verify/${guildId}/discord"
      style="
      background:#5865f2;
      color:white;
      padding:15px 25px;
      border-radius:10px;
      text-decoration:none;
      display:inline-block;
      margin-top:20px;">
      Verificarme con Discord
      </a>
    </body>
    </html>
  `);
});

app.get("/verify/:guildId/discord", (req, res) => {
  const guildId = req.params.guildId;

  const url =
    "https://discord.com/oauth2/authorize" +
    `?client_id=${process.env.CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent("https://bot-con-dashboard.onrender.com/verify/callback")}` +
    "&response_type=code" +
    `&state=${guildId}` +
    "&scope=identify";

  res.redirect(url);
});

// =========================
// INVITE BOT
// =========================
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
async function createBotLog(data) {
  try {
    await BotLog.create(data);
  } catch (error) {
    console.log("❌ Error guardando BotLog:", error);
  }
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

      const buttons = config.ticketButtons?.length
        ? config.ticketButtons.filter(btn => btn.enabled)
        : [
            {
              enabled: true,
              label: "Abrir Ticket",
              emoji: "🎫",
              style: "Success",
              welcomeMessage: ""
            }
          ];

      const selectedButton = buttons[buttonIndex];

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

      const welcomeRaw =
        selectedButton?.welcomeMessage ||
        config.ticketWelcomeMessage ||
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
await createBotLog({
  guildId: interaction.guild.id,
  type: "ticket_created",
  title: "🎫 Ticket creado",
  description: `Ticket creado por ${interaction.user.username}`,
  userId: interaction.user.id,
  username: interaction.user.username,
  channelId: ticketChannel.id,
  metadata: {
    channelName: ticketChannel.name
  }
});

await sendLog(
  interaction.guild,
  config,
  new EmbedBuilder()
    .setTitle("🎫 Ticket creado")
    .setColor(config.ticketEmbedColor || "#23a559")
    .setDescription(
      `🎫 **Canal:** ${ticketChannel}\n` +
      `👤 **Usuario:** ${interaction.user}\n` +
      `🆔 **ID:** \`${interaction.user.id}\``
    )
    .setTimestamp()
);
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

      await sendLog(
        interaction.guild,
        config,
        new EmbedBuilder()
          .setTitle("🔒 Ticket cerrado")
          .setColor(config?.ticketEmbedColor || "#23a559")
          .setDescription(
            `🎫 **Canal:** ${interaction.channel.name}\n` +
            `👤 **Usuario:** <@${data.owner}>\n` +
            `👮 **Cerrado por:** ${interaction.user}\n` +
            `📝 **Razón:**\n${reason}`
          )
          .setTimestamp(),
        [transcript]
      );
await createBotLog({
  guildId: interaction.guild.id,
  type: "ticket_closed",
  title: "🔒 Ticket cerrado",
  description: `Ticket cerrado por ${interaction.user.username}`,
  userId: data.owner,
  username: user?.username || "Usuario",
  staffId: interaction.user.id,
  channelId: interaction.channel.id,
  metadata: {
    reason
  }
});
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
  console.log(`🤖 Bot conectado como ${client.user.tag}`);
});

client.login(process.env.TOKEN);

app.listen(process.env.PORT || 3000, () => {
  console.log(`🌐 Dashboard online en puerto ${process.env.PORT || 3000}`);
});