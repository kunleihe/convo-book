import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import NavigationBar from './components/Common/NavigationBar';
import BookLibrary from './components/BookLibrary/BookLibrary';
import BookReader from './components/BookReader/BookReader';
import DeviceCheck from './components/Common/DeviceCheck';
import ProtectedRoute from './components/Common/ProtectedRoute';
import { useAuth } from './hooks/useAuth.jsx';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

// Component to conditionally render NavigationBar
function ConditionalNavBar() {
  const location = useLocation();
  // Only show nav bar on Library page (home page)
  if (location.pathname === '/') {
    return <NavigationBar />;
  }
  return null;
}

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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </BrowserRouter>
    </div>
  );
}

export default App;
