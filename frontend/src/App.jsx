import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import NavigationBar from './components/Common/NavigationBar';
import BookLibrary from './components/BookLibrary/BookLibrary';
import BookReader from './components/BookReader/BookReader';
import VoiceClient from './components/VoiceClient/VoiceClient';
import TestPageVoiceChat from './components/TestPageVoiceChat';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <NavigationBar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<BookLibrary />} />
            <Route path="/book/:bookId/page/:pageNumber" element={<BookReader />} />
            <Route path="/voice" element={<VoiceClient />} />
            <Route path="/test-page-voice" element={<TestPageVoiceChat />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </BrowserRouter>
    </div>
  );
}

export default App;
