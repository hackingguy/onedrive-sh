import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudArrowUpIcon } from '@heroicons/react/24/outline';

function Home({ isAuthenticated, userName }) {
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = () => {
    setIsSigningIn(true);
    window.location.href = `${process.env.REACT_APP_API_URL}/auth/signin`;
  };

  return (
    <div className="min-h-screen bg-base-200">
      <div className="hero min-h-screen">
        <div className="hero-content text-center">
          <div className="max-w-md">
            <CloudArrowUpIcon className="h-24 w-24 mx-auto text-primary" />
            <h1 className="text-5xl font-bold mt-4">OneDrive to Telegram</h1>
            <p className="py-6">
              Automatically forward your OneDrive files to Telegram. Simple, secure, and efficient.
            </p>
            {isAuthenticated ? (
              <div className="space-y-4">
                <p className="text-xl">Welcome back, {userName}!</p>
                <div className="space-x-4">
                  <Link to="/dashboard" className="btn btn-primary">
                    Go to Dashboard
                  </Link>
                  <Link to="/signout" className="btn btn-ghost">
                    Sign Out
                  </Link>
                </div>
              </div>
            ) : (
              <button 
                onClick={handleSignIn}
                className="btn btn-primary"
                disabled={isSigningIn}
              >
                {isSigningIn ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Signing in...
                  </>
                ) : (
                  'Sign in with Microsoft'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home; 