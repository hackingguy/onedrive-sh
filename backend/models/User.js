const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  microsoftId: {
    type: String,
    required: true,
    unique: true
  },
  displayName: String,
  email: String,
  telegramConfig: {
    botToken: String,
    chatId: String
  },
  accessToken: String,
  refreshToken: String,
  webhookId: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('User', userSchema); 