const mongoose = require("mongoose");

const guildConfigSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    unique: true
  },

  ticketsEnabled: {
    type: Boolean,
    default: false
  },

  ticketCategoryId: {
    type: String,
    default: ""
  },

  staffRoleId: {
    type: String,
    default: ""
  },

  ticketLogsChannelId: {
    type: String,
    default: ""
  },

  ticketPanelName: {
    type: String,
    default: "Panel de Tickets"
  },

  ticketPanelChannelId: {
    type: String,
    default: ""
  },

  supportRoleId: {
    type: String,
    default: ""
  },

  ticketNamePattern: {
    type: String,
    default: "ticket-{user.username}"
  },

  ticketLimit: {
    type: Number,
    default: 1
  },

  ticketWelcomeMessage: {
    type: String,
    default: "Hola {user}, gracias por abrir un ticket. Un miembro del staff te atenderá pronto."
  },

  ticketPanelMessage: {
    type: String,
    default: "Usá el botón de abajo para abrir un ticket."
  },

  ticketEmbedColor: {
    type: String,
    default: "#23a559"
  }
,

ticketButtonLabel: {
  type: String,
  default: "Abrir Ticket"
},

ticketButtonEmoji: {
  type: String,
  default: "🎫"
},

ticketButtonStyle: {
  type: String,
  default: "Success"
}
,

ticketButtons: {
  type: [
    {
      enabled: { type: Boolean, default: false },
      label: { type: String, default: "Abrir Ticket" },
      emoji: { type: String, default: "🎫" },
      style: { type: String, default: "Success" },
      welcomeMessage: { type: String, default: "" }
    }
  ],
  default: []
}
}, {
  timestamps: true
});

module.exports = mongoose.model("GuildConfig", guildConfigSchema);