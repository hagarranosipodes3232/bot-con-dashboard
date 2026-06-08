const mongoose = require("mongoose");

const customCommandSchema = new mongoose.Schema({
  guildId: {
    type: String,
    required: true
  },

  name: {
    type: String,
    required: true
  },

  response: {
    type: String,
    required: true
  },

  type: {
    type: String,
    default: "normal"
  }
}, {
  timestamps: true
});

module.exports = mongoose.model("CustomCommand", customCommandSchema);