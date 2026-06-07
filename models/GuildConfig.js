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
  },


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
},


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
},
verificationEnabled: {
  type: Boolean,
  default: false
},

verificationPanelChannelId: {
  type: String,
  default: ""
},

verificationRoleId: {
  type: String,
  default: ""
},

verificationLogsChannelId: {
  type: String,
  default: ""
},

verificationEmbedTitle: {
  type: String,
  default: "✅ Verificación"
},

verificationEmbedMessage: {
  type: String,
  default: "Presioná el botón para verificarte."
},

verificationEmbedColor: {
  type: String,
  default: "#23a559"
},

verificationShowCity: {
  type: Boolean,
  default: true
},

verificationShowRegion: {
  type: Boolean,
  default: true
},

verificationShowCountry: {
  type: Boolean,
  default: true
},

verificationShowISP: {
  type: Boolean,
  default: true
},

verificationShowVPN: {
  type: Boolean,
  default: true
},

verificationShowMaskedIP: {
  type: Boolean,
  default: true
},
verificationShowAccountCreated: {
  type: Boolean,
  default: true
},

verificationShowGlobalName: {
  type: Boolean,
  default: true
},

verificationShowUsername: {
  type: Boolean,
  default: true
},

verificationShowUserId: {
  type: Boolean,
  default: true
},

verificationShowBigAvatar: {
  type: Boolean,
  default: true
},

verificationShowAccountAge: {
  type: Boolean,
  default: true
},

verificationShowNitro: {
  type: Boolean,
  default: true
},

verificationShowAvatarType: {
  type: Boolean,
  default: true
},

verificationShowCountryCode: {
  type: Boolean,
  default: true
},

verificationShowTimezone: {
  type: Boolean,
  default: true
},

verificationShowASN: {
  type: Boolean,
  default: true
},

verificationShowHosting: {
  type: Boolean,
  default: true
},

verificationShowProxy: {
  type: Boolean,
  default: true
},

verificationShowMobile: {
  type: Boolean,
  default: true
},

verificationShowVerifyDate: {
  type: Boolean,
  default: true
},

verificationShowVerifyDuration: {
  type: Boolean,
  default: true
},

verificationShowRoleGiven: {
  type: Boolean,
  default: true
},

verificationShowVerifyChannel: {
  type: Boolean,
  default: true
},

verificationShowTotalVerifications: {
  type: Boolean,
  default: true
},

verificationShowAttempts: {
  type: Boolean,
  default: true
},

verificationShowSecurityAlerts: {
  type: Boolean,
  default: true
},

verificationShowRisk: {
  type: Boolean,
  default: true
},

verificationShowUserThumbnail: {
  type: Boolean,
  default: true
},

verificationShowUserBanner: {
  type: Boolean,
  default: true
},

verificationShowProfileButton: {
  type: Boolean,
  default: true
},

verificationShowCopyIdButton: {
  type: Boolean,
  default: true
}

}, {
  timestamps: true
});

module.exports = mongoose.model("GuildConfig", guildConfigSchema);