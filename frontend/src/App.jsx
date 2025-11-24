import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import NavigationBar from './components/Common/NavigationBar';
import BookLibrary from './components/BookLibrary/BookLibrary';
import BookReader from './components/BookReader/BookReader';
import VoiceClient from './components/VoiceClient/VoiceClient';
import DeviceCheck from './components/Common/DeviceCheck';
import ProtectedRoute from './components/Common/ProtectedRoute';
import { useAuth } from './hooks/useAuth.jsx';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

// Component to conditionally render NavigationBar
function ConditionalNavBar() {
  const location = useLocation();
  // Don't show nav bar on device check page
  if (location.pathname === '/device-check') {
    return null;
  }
  return <NavigationBar />;
}

function App() {
  const { isAuthenticated, loading } = useAuth();

  // Request microphone permission immediately when app loads
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        stream.getTracks().forEach(track => track.stop());
      })
      .catch(error => {
        // Silent fail - user denied permission
      });
  }, []);

  if (loading) {
    return (
      <div className="App d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
        <div className="spinner-border" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <BrowserRouter>
        {isAuthenticated && <ConditionalNavBar />}
        <main className="main-content">
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <BookLibrary />
                </ProtectedRoute>
              }
            />
            <Route
              path="/device-check"
              element={
                <ProtectedRoute>
                  <DeviceCheck />
                </ProtectedRoute>
              }
            />
            <Route
              path="/book/:bookId/page/:pageNumber"
              element={
                <ProtectedRoute>
                  <BookReader />
                </ProtectedRoute>
              }
            />
            <Route
              path="/voice"
              element={
                <ProtectedRoute>
                  <VoiceClient />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </BrowserRouter>
    </div>
  );
}

export default App;
