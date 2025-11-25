import React from 'react';
import { Navbar, Nav, Container, Button } from 'react-bootstrap';
import { useAuth } from '../../hooks/useAuth.jsx';

const NavigationBar = () => {
    const { logout, user } = useAuth();

    const handleLogout = () => {
        logout();
    };

    return (
        <Navbar className="bg-body-tertiary shadow-sm">
            <Container>
                <Navbar.Brand className="fw-bold">
                    Library
                </Navbar.Brand>
                <Nav className="ms-auto d-flex align-items-center">
                    {user?.username && (
                        <span className="text-muted me-3" style={{ fontSize: '0.9rem' }}>
                            {user.username}
                        </span>
                    )}
                    <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={handleLogout}
                    >
                        Log Out
                    </Button>
                </Nav>
            </Container>
        </Navbar>
    );
};

export default NavigationBar; 