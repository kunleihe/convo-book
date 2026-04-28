import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';
import Login from '../Login/Login';

const ProtectedRoute = ({ children }) => {
    const { isAuthenticated, loading } = useAuth();
    const navigate = useNavigate();

    if (loading) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
                <div className="spinner-border" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Login onLoginSuccess={() => navigate('/device-check')} />;
    }

    return children;
};

export default ProtectedRoute;