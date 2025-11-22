import { useState, useEffect, createContext, useContext } from 'react';

// Create Auth Context
const AuthContext = createContext();

// Auth Provider Component
export const AuthProvider = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState(null);

    // Check if user is logged in on app start
    useEffect(() => {
        const token = localStorage.getItem('authToken');
        const savedUsername = localStorage.getItem('username');
        
        if (token) {
            // Optionally verify token with backend
            setIsAuthenticated(true);
            if (savedUsername) {
                setUser({ username: savedUsername });
            }
        }
        setLoading(false);
    }, []);

    const login = (token, username) => {
        localStorage.setItem('authToken', token);
        if (username) {
            localStorage.setItem('username', username);
            setUser({ username });
        }
        setIsAuthenticated(true);
    };

    const logout = () => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        setIsAuthenticated(false);
        setUser(null);
    };

    const getAuthToken = () => {
        return localStorage.getItem('authToken');
    };

    return (
        <AuthContext.Provider value={{
            isAuthenticated,
            loading,
            user,
            login,
            logout,
            getAuthToken
        }}>
            {children}
        </AuthContext.Provider>
    );
};

// Custom hook to use auth context
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};