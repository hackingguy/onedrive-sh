import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  BellIcon, 
  ArrowPathIcon,
  DocumentArrowUpIcon,
  XCircleIcon
} from '@heroicons/react/24/outline';

function Dashboard({ userName }) {
  // State declarations
  const [webhookStatus, setWebhookStatus] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [fileName, setFileName] = useState('test.txt');
  const [isWebhookLoading, setIsWebhookLoading] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [telegramConfig, setTelegramConfig] = useState({ botToken: '', chatId: '' });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState(null);

  useEffect(() => {
    checkWebhookStatus();
    fetchTelegramConfig();
  }, []);

  const checkWebhookStatus = async () => {
    setIsCheckingStatus(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/webhook-status`, {
        credentials: 'include'
      });
      const data = await response.json();
      setWebhookStatus(data);
    } catch (error) {
      console.error('Error checking webhook status:', error);
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const setupWebhook = async () => {
    setIsWebhookLoading(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/setup-webhook`, {
        method: 'POST',
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        checkWebhookStatus();
      }
    } catch (error) {
      console.error('Error setting up webhook:', error);
    } finally {
      setIsWebhookLoading(false);
    }
  };

  const deleteWebhook = async () => {
    if (!window.confirm('Are you sure you want to delete the webhook?')) {
      return;
    }
    setIsWebhookLoading(true);
    try {
      console.log('Sending delete webhook request to:', `${process.env.REACT_APP_API_URL}/delete-webhook`);
      const response = await fetch(`${process.env.REACT_APP_API_URL}/delete-webhook`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      console.log('Delete webhook response status:', response.status);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Delete webhook response:', data);

      if (data.success) {
        await checkWebhookStatus();
      } else {
        throw new Error(data.error || 'Failed to delete webhook');
      }
    } catch (error) {
      console.error('Error deleting webhook:', error);
      alert('Error deleting webhook: ' + error.message);
    } finally {
      setIsWebhookLoading(false);
    }
  };

  const uploadFile = async (file) => {
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/upload-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fileName })
      });

      const data = await response.json();
      
      const maxChunkSize = 4 * 1024 * 1024;
      const fileSize = file.size;
      let start = 0;

      while (start < fileSize) {
        const end = Math.min(start + maxChunkSize, fileSize);
        const chunk = file.slice(start, end);
        
        await fetch(data.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Length': (end - start).toString(),
            'Content-Range': `bytes ${start}-${end - 1}/${fileSize}`
          },
          body: chunk
        });

        start = end;
        setUploadProgress(Math.round((end / fileSize) * 100));
      }
      
      alert('File uploaded successfully!');
    } catch (error) {
      alert('Error uploading file: ' + error.message);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const fetchTelegramConfig = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/telegram-config`, {
        credentials: 'include'
      });
      const data = await response.json();
      setTelegramConfig(data);
    } catch (error) {
      console.error('Error fetching Telegram config:', error);
    }
  };

  const saveTelegramConfig = async () => {
    setIsSavingConfig(true);
    setConfigMessage(null);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/telegram-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(telegramConfig)
      });
      const data = await response.json();
      
      if (data.success) {
        setConfigMessage({ type: 'success', text: 'Configuration saved successfully!' });
      } else {
        setConfigMessage({ type: 'error', text: data.error });
      }
    } catch (error) {
      setConfigMessage({ type: 'error', text: 'Error saving configuration' });
    } finally {
      setIsSavingConfig(false);
    }
  };

  return (
    <div className="min-h-screen bg-base-200 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-lg opacity-75">Welcome, {userName}</p>
          </div>
          <div className="space-x-2">
            <Link to="/" className="btn btn-ghost">Home</Link>
            <Link to="/signout" className="btn btn-outline">Sign Out</Link>
          </div>
        </div>

        <div className="grid gap-6">
          {/* Webhook Status Card */}
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">
                <BellIcon className="h-6 w-6" />
                Webhook Status
              </h2>
              <div className="flex items-center space-x-4">
                {webhookStatus?.hasActiveWebhook ? (
                  <button 
                    onClick={deleteWebhook} 
                    className="btn btn-error"
                    disabled={isWebhookLoading}
                  >
                    {isWebhookLoading ? (
                      <span className="loading loading-spinner loading-sm"></span>
                    ) : (
                      <XCircleIcon className="h-5 w-5 mr-2" />
                    )}
                    Delete Webhook
                  </button>
                ) : (
                  <button 
                    onClick={setupWebhook}
                    className="btn btn-primary"
                    disabled={isWebhookLoading}
                  >
                    {isWebhookLoading ? (
                      <span className="loading loading-spinner loading-sm"></span>
                    ) : (
                      <BellIcon className="h-5 w-5 mr-2" />
                    )}
                    Setup Webhook
                  </button>
                )}
                <button 
                  onClick={checkWebhookStatus}
                  className="btn btn-ghost"
                  disabled={isCheckingStatus}
                >
                  {isCheckingStatus ? (
                    <span className="loading loading-spinner loading-sm"></span>
                  ) : (
                    <ArrowPathIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
              {webhookStatus && (
                <div className="mt-4">
                  <button
                    onClick={() => setIsDetailsOpen(!isDetailsOpen)}
                    className="w-full flex items-center justify-between p-3 bg-base-200 rounded-lg hover:bg-base-300 transition-colors"
                  >
                    <span className="font-medium">View Details</span>
                    <svg
                      className={`w-5 h-5 transform transition-transform duration-200 ${
                        isDetailsOpen ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                  {isDetailsOpen && (
                    <div className="mt-3 bg-base-300 p-4 rounded-lg">
                      <pre className="overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(webhookStatus, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Telegram Configuration Card */}
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.2-.04-.28-.02-.12.02-1.96 1.25-5.54 3.69-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.28-.48.76-.73 2.97-1.29 4.96-2.15 5.95-2.57 2.83-1.21 3.42-1.42 3.8-1.43.08 0 .26.02.38.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                </svg>
                Telegram Configuration
              </h2>
              <div className="form-control w-full gap-4">
                <div className="flex flex-col gap-2">
                  <label className="label">
                    <span className="label-text">Bot Token</span>
                  </label>
                  <input
                    type="password"
                    placeholder="Enter your bot token"
                    className="input input-bordered w-full"
                    value={telegramConfig.botToken}
                    onChange={(e) => setTelegramConfig(prev => ({
                      ...prev,
                      botToken: e.target.value
                    }))}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="label">
                    <span className="label-text">Chat ID</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter your chat ID"
                    className="input input-bordered w-full"
                    value={telegramConfig.chatId}
                    onChange={(e) => setTelegramConfig(prev => ({
                      ...prev,
                      chatId: e.target.value
                    }))}
                  />
                </div>
                <div className="flex items-center gap-4">
                  <button
                    className={`btn btn-primary ${isSavingConfig ? 'loading' : ''}`}
                    onClick={saveTelegramConfig}
                    disabled={isSavingConfig}
                  >
                    {isSavingConfig ? (
                      <span className="loading loading-spinner loading-sm"></span>
                    ) : 'Save Configuration'}
                  </button>
                  {configMessage && (
                    <span className={`text-${configMessage.type === 'success' ? 'success' : 'error'}`}>
                      {configMessage.text}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* File Upload Card */}
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">
                <DocumentArrowUpIcon className="h-6 w-6" />
                Upload File
              </h2>
              <div className="form-control w-full gap-4">
                <div className="flex gap-4 items-center">
                  <input
                    type="text"
                    placeholder="File name"
                    className="input input-bordered flex-1"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                  />
                  <span className="text-sm opacity-70">
                    (will be uploaded as this name)
                  </span>
                </div>
                <input
                  type="file"
                  className="file-input file-input-bordered w-full"
                  onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
                  disabled={isUploading}
                />
              </div>
              {isUploading && (
                <div className="w-full">
                  <progress 
                    className="progress progress-primary w-full" 
                    value={uploadProgress} 
                    max="100"
                  ></progress>
                  <p className="text-center mt-2">{uploadProgress}%</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;