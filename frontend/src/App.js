import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './components/Home';
import Dashboard from './components/Dashboard';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userName, setUserName] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.REACT_APP_API_URL}/test-graph`, {
      credentials: 'include'
    })
    .then(response => {
      if (response.ok) {
        return response.json();
      }
      throw new Error('Not authenticated');
    })
    .then(data => {
      setIsAuthenticated(true);
      setUserName(data.user.displayName);
    })
    .catch(() => {
      setIsAuthenticated(false);
      setUserName('');
    })
    .finally(() => {
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home isAuthenticated={isAuthenticated} userName={userName} />} />
        <Route 
          path="/dashboard" 
          element={isAuthenticated ? <Dashboard userName={userName} /> : <Navigate to="/" />} 
        />
        <Route 
          path="/signout" 
          element={<Navigate to={`${process.env.REACT_APP_API_URL}/auth/signout`} />} 
        />
      </Routes>
    </Router>
  );
}

export default App;
