export const config = {
  apiBaseUrl: process.env.REACT_APP_API_URL || 'http://localhost:3000',
  auth: {
    clientId: process.env.REACT_APP_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.REACT_APP_TENANT_ID}`,
    redirectUri: process.env.REACT_APP_REDIRECT_URI,
  }
}; 