require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const passport = require('passport');
const { BearerStrategy } = require('passport-azure-ad');
const msal = require('@azure/msal-node');
const config = require('./authConfig');
const { Client } = require('@microsoft/microsoft-graph-client');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const cors = require('cors');
const connectDB = require('./config/database');
const UserRepository = require('./repositories/UserRepository');

// Connect to MongoDB
connectDB();

// Initialize Express app
const app = express();

// CORS configuration
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
    store: new MemoryStore({
        checkPeriod: 86400000
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

// Initialize MSAL
const msalClient = new msal.ConfidentialClientApplication(config);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user.microsoftId);
});

passport.deserializeUser(async (microsoftId, done) => {
    try {
        const user = await UserRepository.getUserById(microsoftId);
        done(null, user);
    } catch (error) {
        done(error);
    }
});

// Microsoft Graph client helper
function getAuthenticatedClient(accessToken) {
    return Client.init({
        authProvider: (done) => {
            done(null, accessToken);
        },
        defaultVersion: 'v1.0'
    });
}

// Middleware to check if user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Not authenticated' });
}

// Routes
app.get('/auth/signin', async (req, res) => {
    const authUrl = await msalClient.getAuthCodeUrl({
        scopes: config.scopes,
        redirectUri: config.auth.redirectUri
    });
    res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
    try {
        const tokenResponse = await msalClient.acquireTokenByCode({
            code: req.query.code,
            scopes: config.scopes,
            redirectUri: config.auth.redirectUri
        });

        const { account } = tokenResponse;
        
        // Save user data to database
        const user = await UserRepository.createOrUpdateUser({
            microsoftId: account.homeAccountId,
            displayName: account.name,
            email: account.username,
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken
        });

        // Set up session properly
        req.login(user, async (err) => {
            if (err) {
                console.error('Session setup error:', err);
                return res.redirect(`${process.env.FRONTEND_URL}?error=session_failed`);
            }
            
            // Store the session
            req.session.user = user;
            req.session.accessToken = tokenResponse.accessToken;
            
            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed`);
    }
});

// Add a session check endpoint
app.get('/check-session', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    
    if (req.isAuthenticated() && req.user) {
        res.json({
            isAuthenticated: true,
            user: {
                displayName: req.user.displayName,
                email: req.user.email
            }
        });
    } else {
        res.json({ 
            isAuthenticated: false,
            user: null
        });
    }
});

// Telegram configuration endpoints
app.get('/telegram-config', ensureAuthenticated, async (req, res) => {
    try {
        const user = await UserRepository.getUserById(req.user.microsoftId);
        res.json(user.telegramConfig || { botToken: '', chatId: '' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch Telegram configuration' });
    }
});

app.post('/telegram-config', ensureAuthenticated, async (req, res) => {
    try {
        const { botToken, chatId } = req.body;
        
        // Test the configuration
        const testBot = new TelegramBot(botToken, { polling: false });
        await testBot.getMe();
        await testBot.sendMessage(chatId, 'Configuration test successful! You will receive OneDrive files in this chat.');
        
        // Save configuration
        await UserRepository.updateTelegramConfig(req.user.microsoftId, { botToken, chatId });
        
        res.json({ success: true, message: 'Telegram configuration updated successfully' });
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: 'Invalid Telegram configuration. Please check your Bot Token and Chat ID.'
        });
    }
});

// Webhook handling
app.post('/webhook', express.raw({type: '*/*'}), async (req, res) => {
    const validationToken = req.query.validationToken;
    if (validationToken) {
        return res.status(200).set('Content-Type', 'text/plain').send(validationToken);
    }

    try {
        const body = JSON.parse(req.body.toString());
        if (body.value && body.value[0]) {
            const notification = body.value[0];
            const user = await UserRepository.getUserByWebhookId(notification.subscriptionId);
            
            if (!user) {
                console.error('No user found for webhook:', notification.subscriptionId);
                return res.status(404).send('No user found for this webhook');
            }

            if (notification.clientState !== process.env.WEBHOOK_SECRET) {
                console.error('Invalid webhook secret');
                return res.status(401).send('Invalid notification');
            }

            await handleFileChange(notification, user);
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).send('Internal server error');
    }
});

// Update webhook setup endpoint
app.post('/setup-webhook', ensureAuthenticated, async (req, res) => {
    try {
        const client = getAuthenticatedClient(req.user.accessToken);
        
        // Delete any existing webhooks for this user
        const existingSubscriptions = await client.api('/subscriptions').get();
        for (const sub of existingSubscriptions.value) {
            if (sub.applicationId === config.auth.clientId) {
                try {
                    await client.api(`/subscriptions/${sub.id}`).delete();
                    console.log('Deleted existing subscription:', sub.id);
                } catch (deleteError) {
                    console.error('Error deleting subscription:', deleteError);
                }
            }
        }
        
        // Get the user's drive ID
        const drive = await client.api('/me/drive').get();

        const subscriptionData = {
            changeType: "updated",
            notificationUrl: process.env.WEBHOOK_URL,
            resource: `/drives/${drive.id}/root`,
            expirationDateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            clientState: process.env.WEBHOOK_SECRET
        };

        const subscription = await client.api('/subscriptions').post(subscriptionData);
        
        // Save webhook ID to user
        await UserRepository.updateWebhookId(req.user.microsoftId, subscription.id);
        
        res.json({ 
            success: true, 
            subscription,
            message: 'New webhook subscription created'
        });
    } catch (error) {
        console.error('Error setting up webhook:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update webhook status endpoint
app.get('/webhook-status', ensureAuthenticated, async (req, res) => {
    try {
        const client = getAuthenticatedClient(req.user.accessToken);
        const subscriptions = await client.api('/subscriptions').get();
        
        const userWebhooks = subscriptions.value.filter(
            sub => sub.applicationId === config.auth.clientId
        );

        res.json({
            hasActiveWebhook: userWebhooks.length > 0,
            webhookCount: userWebhooks.length,
            subscriptions: userWebhooks
        });
    } catch (error) {
        console.error('Error checking webhook status:', error);
        res.status(500).json({ 
            error: error.message,
            hasActiveWebhook: false,
            webhookCount: 0
        });
    }
});

// Update file upload endpoint
app.post('/upload-test', ensureAuthenticated, async (req, res) => {
    try {
        const client = getAuthenticatedClient(req.user.accessToken);
        const drive = await client.api('/me/drive').get();
        
        const uploadSession = await client.api(`/drives/${drive.id}/items/root:/${req.body.fileName}:/createUploadSession`)
            .post({});
        
        res.json({ 
            uploadUrl: uploadSession.uploadUrl,
            fileName: req.body.fileName,
            driveId: drive.id
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update handleFileChange function
async function handleFileChange(notification, user) {
    if (!user.telegramConfig?.botToken || !user.telegramConfig?.chatId) {
        throw new Error('Telegram configuration not set for user');
    }
    
    const client = getAuthenticatedClient(user.accessToken);
    
    try {
        const resourceParts = notification.resource.split('/');
        const driveId = resourceParts[2];
        
        const rootItems = await client.api(`/drives/${driveId}/items/root/children`)
            .select('id,name,size,lastModifiedDateTime')
            .orderby('lastModifiedDateTime desc')
            .top(1)
            .get();
            
        if (!rootItems.value || rootItems.value.length === 0) {
            return;
        }

        const mostRecentFile = rootItems.value[0];
        const fileWithUrl = await client.api(`/drives/${driveId}/items/${mostRecentFile.id}`)
            .select('@microsoft.graph.downloadUrl')
            .get();

        if (!fileWithUrl['@microsoft.graph.downloadUrl']) {
            return;
        }

        const response = await axios({
            url: fileWithUrl['@microsoft.graph.downloadUrl'],
            method: 'GET',
            responseType: 'stream'
        });

        const tempFilePath = `./${mostRecentFile.name}`;
        const writer = fs.createWriteStream(tempFilePath);
        
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        const bot = new TelegramBot(user.telegramConfig.botToken, { polling: false });
        await bot.sendDocument(user.telegramConfig.chatId, tempFilePath);

        fs.unlinkSync(tempFilePath);
    } catch (error) {
        console.error('Error handling file change:', error);
        throw error;
    }
}

// Update delete webhook endpoint
app.post('/delete-webhook', ensureAuthenticated, async (req, res) => {
    try {
        const client = getAuthenticatedClient(req.user.accessToken);
        
        // Check for existing subscriptions
        const existingSubscriptions = await client.api('/subscriptions').get();
        let deletedCount = 0;

        // Delete subscriptions that match our applicationId
        for (const sub of existingSubscriptions.value) {
            if (sub.applicationId === config.auth.clientId) {
                try {
                    await client.api(`/subscriptions/${sub.id}`).delete();
                    console.log('Deleted subscription:', sub.id);
                    deletedCount++;
                } catch (deleteError) {
                    console.error('Error deleting subscription:', sub.id, deleteError);
                }
            }
        }

        // Update user's webhook ID in database
        await UserRepository.updateWebhookId(req.user.microsoftId, null);

        res.json({ 
            success: true, 
            message: `Deleted ${deletedCount} webhook subscription(s)`,
            deletedCount
        });
    } catch (error) {
        console.error('Error deleting webhook:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Add this near the top of your routes
app.get('/api-test', (req, res) => {
    res.json({ status: 'API is working' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
