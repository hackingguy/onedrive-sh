const crypto = require('crypto');
const User = require('../models/User');

class UserRepository {
  constructor() {
    this.encryptionKey = process.env.ENCRYPTION_KEY;
  }

  // Encryption helpers
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  decrypt(text) {
    const [ivHex, encryptedHex] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptionKey), iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }

  async createOrUpdateUser(userData) {
    const {
      microsoftId,
      displayName,
      email,
      accessToken,
      refreshToken
    } = userData;

    const encryptedAccessToken = this.encrypt(accessToken);
    const encryptedRefreshToken = refreshToken ? this.encrypt(refreshToken) : null;

    const user = await User.findOneAndUpdate(
      { microsoftId },
      {
        displayName,
        email,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        $setOnInsert: { createdAt: new Date() },
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    return user;
  }

  async getUserById(microsoftId) {
    const user = await User.findOne({ microsoftId });
    if (!user) return null;

    // Decrypt tokens before returning
    if (user.accessToken) {
      user.accessToken = this.decrypt(user.accessToken);
    }
    if (user.refreshToken) {
      user.refreshToken = this.decrypt(user.refreshToken);
    }

    return user;
  }

  async updateTelegramConfig(microsoftId, config) {
    return await User.findOneAndUpdate(
      { microsoftId },
      {
        telegramConfig: config,
        updatedAt: new Date()
      },
      { new: true }
    );
  }

  async updateWebhookId(microsoftId, webhookId) {
    return await User.findOneAndUpdate(
      { microsoftId },
      {
        webhookId,
        updatedAt: new Date()
      },
      { new: true }
    );
  }

  async getUserByWebhookId(webhookId) {
    const user = await User.findOne({ webhookId });
    if (!user) return null;

    // Decrypt tokens before returning
    if (user.accessToken) {
      user.accessToken = this.decrypt(user.accessToken);
    }
    if (user.refreshToken) {
      user.refreshToken = this.decrypt(user.refreshToken);
    }

    return user;
  }
}

module.exports = new UserRepository(); 