import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import NavigationBar from './components/Common/NavigationBar';
import BookLibrary from './components/BookLibrary/BookLibrary';
import BookReader from './components/BookReader/BookReader';
import VoiceClient from './components/VoiceClient/VoiceClient';
import ProtectedRoute from './components/Common/ProtectedRoute';
import { useAuth } from './hooks/useAuth.jsx';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

function App() {
  const { isAuthenticated, loading } = useAuth();

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
        {isAuthenticated && <NavigationBar />}
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
