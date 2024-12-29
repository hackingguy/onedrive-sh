const config = {
    auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        tenantId: process.env.AZURE_TENANT_ID,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
        redirectUri: process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback'
    },
    system: {
        loggerOptions: {
            loggerCallback(loglevel, message) {
                console.log(message);
            },
            piiLoggingEnabled: false,
            logLevel: "Info"
        }
    }
};

// Required scopes for the application
config.scopes = [
    'user.read',
    'files.read',
    'files.read.all',
    'files.readwrite',
    'files.readwrite.all',
    'offline_access'
];

module.exports = config; 