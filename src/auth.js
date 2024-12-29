require('dotenv').config();

const msal = require('@azure/msal-node');

const config = {
    auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`
    }
};

const cca = new msal.ConfidentialClientApplication(config);

async function getAccessToken() {
    try {
        const tokenRequest = {
            scopes: ['https://graph.microsoft.com/.default'],
            skipCache: false
        };

        const response = await cca.acquireTokenByClientCredential(tokenRequest);
        console.log('Token acquired successfully');
        return response.accessToken;
    } catch (error) {
        console.error('Error acquiring token:', error);
        throw error;
    }
}

// Add debug logging
console.log('Auth Environment Variables Status:', {
    clientId: process.env.AZURE_CLIENT_ID ? 'Present' : 'Missing',
    clientSecret: process.env.AZURE_CLIENT_SECRET ? 'Present' : 'Missing',
    tenantId: process.env.AZURE_TENANT_ID ? 'Present' : 'Missing'
});

// Add environment variable checks
const requiredAuthVars = [
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_TENANT_ID'
];

for (const envVar of requiredAuthVars) {
    if (!process.env[envVar]) {
        console.error(`Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

module.exports = { getAccessToken }; 