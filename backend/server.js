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

// Start with app initialization
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
    store: new MemoryStore({
        checkPeriod: 86400000 // prune expired entries every 24h
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Initialize MSAL
const msalClient = new msal.ConfidentialClientApplication(config);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

// Initialize Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

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
    if (req.session.accessToken) {
        return next();
    }
    res.redirect('/auth/signin');
}

// Routes
app.get('/', (req, res) => {
    res.send(`
        <h1>OneDrive to Telegram</h1>
        ${req.session.user ? `
            <p>Welcome ${req.session.user.name || req.session.user.username}!</p>
            <a href="/dashboard">Go to Dashboard</a>
            <br>
            <a href="/auth/signout">Sign Out</a>
        ` : `
            <a href="/auth/signin">Sign in with Microsoft</a>
        `}
    `);
});

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

        req.session.accessToken = tokenResponse.accessToken;
        req.session.user = tokenResponse.account;
        
        // Store token globally
        globalAccessToken = tokenResponse.accessToken;
        
        // Redirect to frontend dashboard
        res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
    } catch (error) {
        console.error('Auth error:', error);
        res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed`);
    }
});

app.get('/auth/signout', (req, res) => {
    req.session.destroy();
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:3001');
});

app.get('/dashboard-data', ensureAuthenticated, async (req, res) => {
    try {
        const client = getAuthenticatedClient(req.session.accessToken);
        const user = await client.api('/me').get();
        
        res.json({
            user: {
                name: user.displayName,
                email: user.userPrincipalName
            },
            isAuthenticated: true
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).json({ 
            error: error.message,
            isAuthenticated: false 
        });
    }
});

app.get('/test-graph', ensureAuthenticated, async (req, res) => {
    try {
        const client = getAuthenticatedClient(req.session.accessToken);
        
        // Test user profile access
        const user = await client.api('/me').get();
        
        // Test OneDrive access
        const files = await client.api('/me/drive/root/children')
            .select('name,size,lastModifiedDateTime')
            .top(5)
            .get();

        res.json({
            user: {
                displayName: user.displayName,
                email: user.userPrincipalName
            },
            recentFiles: files.value.map(f => ({
                name: f.name,
                size: f.size,
                modified: f.lastModifiedDateTime
            }))
        });
    } catch (error) {
        console.error('Graph API test error:', error);
        res.status(500).json({
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Webhook setup and handling
app.post('/setup-webhook', ensureAuthenticated, async (req, res) => {
    try {
        const client = getAuthenticatedClient(req.session.accessToken);
        
        // Check for existing subscriptions
        const existingSubscriptions = await client.api('/subscriptions').get();
        
        // Delete all existing subscriptions with our applicationId
        for (const sub of existingSubscriptions.value) {
            if (sub.applicationId === config.auth.clientId) {
                try {
                    await client.api(`/subscriptions/${sub.id}`).delete();
                    console.log('Deleted existing subscription:', sub.id);
                } catch (deleteError) {
                    console.error('Error deleting subscription:', sub.id, deleteError);
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

        const subscription = await client.api('/subscriptions')
            .post(subscriptionData);
        
        // Save the active subscription
        activeSubscription = subscription;
        fs.writeFileSync('subscription.json', JSON.stringify(subscription, null, 2));
        
        res.json({ 
            success: true, 
            subscription,
            message: 'New webhook subscription created'
        });
    } catch (error) {
        console.error('Error setting up webhook:', error);
        res.status(500).json({ 
            error: error.message,
            details: error.body
        });
    }
});

// Add a new endpoint to get subscription status
app.get('/webhook-status', ensureAuthenticated, async (req, res) => {
    try {
        const client = getAuthenticatedClient(req.session.accessToken);
        const subscriptions = await client.api('/subscriptions').get();
        
        // Find our subscriptions by matching applicationId
        const ourSubscriptions = subscriptions.value.filter(sub => 
            sub.applicationId === config.auth.clientId
        );

        console.log('Found our subscriptions:', ourSubscriptions.length);
        console.log('Our application ID:', config.auth.clientId);

        res.json({
            activeSubscription: ourSubscriptions[0] || null,
            allSubscriptions: subscriptions.value,
            hasActiveWebhook: ourSubscriptions.length > 0,
            webhookCount: ourSubscriptions.length,
            ourAppId: config.auth.clientId
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

// Store access token globally for webhook handling
let globalAccessToken = null;
let activeSubscription = null;
const processedRequests = new Set();
const processedFiles = new Set();

// Add at the top with other global variables
let telegramConfig = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
};

// Add new endpoints for Telegram configuration
app.get('/telegram-config', ensureAuthenticated, (req, res) => {
    res.json({
        botToken: telegramConfig.botToken || '',
        chatId: telegramConfig.chatId || ''
    });
});

app.post('/telegram-config', ensureAuthenticated, async (req, res) => {
    try {
        const { botToken, chatId } = req.body;
        
        // Test the configuration
        const testBot = new TelegramBot(botToken, { polling: false });
        await testBot.getMe(); // Verify bot token is valid
        
        // Test sending a message
        await testBot.sendMessage(chatId, 'Configuration test successful! You will receive OneDrive files in this chat.');
        
        // Save the configuration
        telegramConfig = { botToken, chatId };
        
        // Update the main bot instance
        bot = new TelegramBot(botToken, { polling: false });
        
        res.json({ success: true, message: 'Telegram configuration updated successfully' });
    } catch (error) {
        console.error('Error updating Telegram config:', error);
        res.status(400).json({ 
            success: false, 
            error: 'Invalid Telegram configuration. Please check your Bot Token and Chat ID.'
        });
    }
});

// Update handleFileChange to use the current configuration
async function handleFileChange(notification) {
    if (!telegramConfig.botToken || !telegramConfig.chatId) {
        throw new Error('Telegram configuration not set');
    }
    
    console.log('Handling file change:', notification);
    
    if (!globalAccessToken) {
        throw new Error('No access token available');
    }
    
    const client = getAuthenticatedClient(globalAccessToken);
    
    try {
        // Extract the drive ID properly from the resource path
        const resourceParts = notification.resource.split('/');
        const driveId = resourceParts[2];  // Get the full drive ID including the 'b!' prefix
        
        console.log('Using drive ID:', driveId);

        // Get the root folder contents using the full drive ID
        const rootItems = await client.api(`/drives/${driveId}/items/root/children`)
            .select('id,name,size,lastModifiedDateTime')
            .orderby('lastModifiedDateTime desc')
            .top(1)
            .get();
            
        console.log('Root items response:', rootItems);

        if (!rootItems.value || rootItems.value.length === 0) {
            console.log('No files found in root');
            return;
        }

        const mostRecentFile = rootItems.value[0];
        console.log('Most recent file:', mostRecentFile);

        // Get the download URL in a separate request
        const fileWithUrl = await client.api(`/drives/${driveId}/items/${mostRecentFile.id}`)
            .select('@microsoft.graph.downloadUrl')
            .get();

        console.log('File download info:', fileWithUrl);

        if (!fileWithUrl['@microsoft.graph.downloadUrl']) {
            console.log('No download URL available for file');
            return;
        }

        console.log('Downloading file:', mostRecentFile.name);
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

        console.log('File downloaded:', tempFilePath);

        try {
            await bot.sendDocument(telegramConfig.chatId, tempFilePath);
            console.log('File sent to Telegram');
        } catch (telegramError) {
            console.error('Error sending to Telegram:', telegramError);
            throw telegramError;
        } finally {
            // Clean up temp file regardless of success or failure
            try {
                fs.unlinkSync(tempFilePath);
                console.log('Temporary file cleaned up');
            } catch (cleanupError) {
                console.error('Error cleaning up temp file:', cleanupError);
            }
        }
    } catch (error) {
        console.error('Error handling file change:', error);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            statusCode: error.statusCode,
            body: error.body
        });
        throw error;
    }
}

// Add retry helper function with delay
async function retryOnce(fn, delay = 1000) {
    try {
        return await fn();
    } catch (error) {
        if (error.statusCode === 500) {
            console.log('First attempt failed with 500, waiting before retry...');
            await new Promise(resolve => setTimeout(resolve, delay));
            console.log('Retrying now...');
            return await fn();
        }
        throw error;
    }
}

// Update webhook endpoint with duplicate prevention
app.post('/webhook', express.raw({type: '*/*'}), async (req, res) => {
    // Get unique identifiers from the request
    const requestId = req.headers['request-id'];
    const timestamp = req.headers['request-timestamp'];
    const uniqueId = `${requestId}-${timestamp}`;

    if (processedRequests.has(uniqueId)) {
        console.log('Duplicate webhook request detected, skipping:', uniqueId);
        return res.status(200).send('OK');
    }

    let retryCount = 0;
    const maxRetries = 1;

    const processWebhook = async () => {
        console.log(`Processing webhook (attempt ${retryCount + 1})`);
        console.log('Request unique ID:', uniqueId);
        console.log('Received webhook request with headers:', req.headers);

        // Check for validation token in query parameters
        const validationToken = req.query.validationToken;
        
        if (validationToken) {
            console.log('Validation request received with token:', validationToken);
            return res.status(200)
                     .set('Content-Type', 'text/plain')
                     .send(validationToken);
        }

        // Parse JSON body for non-validation requests
        let body;
        try {
            if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
                body = req.body;
            } else {
                const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
                console.log('Raw webhook body:', rawBody);
                body = rawBody ? JSON.parse(rawBody) : {};
            }
        } catch (e) {
            console.error('Error parsing webhook body:', e);
            console.log('Raw body that failed to parse:', req.body);
            return res.status(400).send('Invalid request body');
        }

        console.log('Parsed webhook body:', body);

        // For regular notifications
        if (body && body.value && body.value.length > 0) {
            const notification = body.value[0];
            
            // Generate a unique file identifier
            const fileId = `${notification.resource}-${notification.subscriptionId}`;
            
            if (processedFiles.has(fileId)) {
                console.log('File already processed, skipping:', fileId);
                return res.status(200).send('OK');
            }

            if (!notification.clientState || notification.clientState !== process.env.WEBHOOK_SECRET) {
                console.error('Invalid webhook secret');
                return res.status(401).send('Invalid notification');
            }

            try {
                await handleFileChange(notification);
                
                // Mark both request and file as processed
                processedRequests.add(uniqueId);
                processedFiles.add(fileId);

                // Clean up old entries after 5 minutes
                setTimeout(() => {
                    processedRequests.delete(uniqueId);
                    processedFiles.delete(fileId);
                }, 5 * 60 * 1000);

                return res.status(200)
                    .set('Cache-Control', 'no-store')
                    .send('OK');
            } catch (error) {
                console.error(`Error processing webhook:`, error);
                if (error.statusCode === 500 && retryCount < maxRetries) {
                    retryCount++;
                    return await processWebhook();
                }
                return res.status(error.statusCode || 500).send(error.message);
            }
        }

        // Default response for empty notifications
        return res.status(200)
            .set('Cache-Control', 'no-store')
            .send('OK');
    };

    try {
        await processWebhook();
    } catch (error) {
        console.error('Unhandled webhook error:', error);
        if (!res.headersSent) {
            res.status(500).send('Internal server error');
        }
    }
});

// Add upload endpoint
app.post('/upload-test', ensureAuthenticated, async (req, res) => {
    try {
        const client = getAuthenticatedClient(req.session.accessToken);
        
        // First get the drive info
        const drive = await client.api('/me/drive').get();
        console.log('Uploading to drive:', drive.id);
        
        // Create upload session in the root folder - simplified path
        const uploadSession = await client.api(`/drives/${drive.id}/items/root:/${req.body.fileName}:/createUploadSession`)
            .post({});
        
        console.log('Created upload session:', uploadSession);
        
        res.json({ 
            uploadUrl: uploadSession.uploadUrl,
            fileName: req.body.fileName,
            driveId: drive.id
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ 
            error: error.message,
            details: error.response?.data || error.body
        });
    }
});

// Add delete webhook endpoint
app.post('/delete-webhook', ensureAuthenticated, async (req, res) => {
    try {
        const client = getAuthenticatedClient(req.session.accessToken);
        
        // Check for existing subscriptions
        const existingSubscriptions = await client.api('/subscriptions').get();
        let deletedCount = 0;

        // Delete subscriptions that match our applicationId
        for (const sub of existingSubscriptions.value) {
            if (sub.applicationId === config.auth.clientId) {
                console.log('Deleting subscription:', sub.id, 'with appId:', sub.applicationId);
                try {
                    await client.api(`/subscriptions/${sub.id}`).delete();
                    deletedCount++;
                } catch (deleteError) {
                    console.error('Error deleting subscription:', sub.id, deleteError);
                }
            } else {
                console.log('Skipping subscription:', sub.id, 'with appId:', sub.applicationId);
            }
        }

        // Clear the active subscription
        activeSubscription = null;
        if (fs.existsSync('subscription.json')) {
            fs.unlinkSync('subscription.json');
        }

        res.json({ 
            success: true, 
            message: `Deleted ${deletedCount} webhook subscription(s)`,
            deletedCount
        });
    } catch (error) {
        console.error('Error deleting webhook:', error);
        res.status(500).json({ error: error.message });
    }
});

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
