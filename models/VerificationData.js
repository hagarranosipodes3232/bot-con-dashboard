const mongoose = require("mongoose");

const VerificationDataSchema = new mongoose.Schema({
  guildId: String,
  userId: String,
  username: String,

  ip: String,
  maskedIP: String,

  country: String,
  countryCode: String,
  region: String,
  city: String,
  isp: String,
  asn: String,
  timezone: String,

  proxy: Boolean,
  hosting: Boolean,
  mobile: Boolean,

  accountCreatedAt: Date,
  accountAgeDays: Number,

  verifiedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("VerificationData", VerificationDataSchema);