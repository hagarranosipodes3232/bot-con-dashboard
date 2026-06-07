const mongoose = require("mongoose");

const botLogSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true,
    index: true
  },

  type: {
    type: String,
    required: true
  },

  title: {
    type: String,
    required: true
  },

  description: {
    type: String,
    default: ""
  },

  userId: {
    type: String,
    default: ""
  },

  username: {
    type: String,
    default: ""
  },

  staffId: {
    type: String,
    default: ""
  },

  channelId: {
    type: String,
    default: ""
  },

  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

module.exports = mongoose.model("BotLog", botLogSchema);